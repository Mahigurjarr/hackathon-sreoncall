import { Types } from 'mongoose';
import { AgentDefinition, AgentDefinitionDocument } from '../models/agent-definition.model';
import { AgentInstallation, AgentInstallationDocument, AutonomyLevel, AgentConfiguration } from '../models/agent-installation.model';
import { AgentExecution, AgentExecutionDocument, ExecutionAction, ExecutionRecommendation } from '../models/agent-execution.model';
import { AgentApproval } from '../models/agent-approval.model';
import { AgentUsage } from '../models/agent-usage.model';
import { generateToolUseCompletion, isAIAvailable, getClientForTenant } from './ai.service';
import { buildAgentContext } from './agent-context.service';
import { getToolsForAgent, getToolDefinitionsForLLM, getTool, getToolRiskLevel } from './agent-tool-registry';
import { AGENT_PROMPTS } from '../utils/agent-prompts';
import { getConfig } from '../config/index';
import { getJetStream } from '../config/nats';
import { StringCodec } from 'nats';
import { logger } from '../utils/logger';

const sc = StringCodec();

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExecuteAgentOptions {
  agentSlug: string;
  trigger: {
    type: 'event' | 'schedule' | 'manual' | 'agent';
    event_type?: string;
    source_id?: string;
    parent_execution_id?: string;
  };
  tenantId: string;
  consumerTenantId?: string;
  context?: Record<string, any>;
}

export interface ExecuteAgentResult {
  execution_id: string;
  status: string;
  actions_taken: number;
  recommendations: number;
  cost_cents: number;
}

// ─── Risk level ordering ─────────────────────────────────────────────────────

const RISK_ORDER: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

function riskMeetsThreshold(actionRisk: string, threshold: string): boolean {
  return (RISK_ORDER[actionRisk] || 2) >= (RISK_ORDER[threshold] || 2);
}

// ─── Circuit Breaker State (in-memory) ───────────────────────────────────────

const circuitBreakers = new Map<string, { failures: number; disabledUntil: number }>();

function isCircuitBroken(key: string): boolean {
  const cb = circuitBreakers.get(key);
  if (!cb) return false;
  if (Date.now() > cb.disabledUntil) {
    circuitBreakers.delete(key);
    return false;
  }
  return true;
}

function recordFailure(key: string): void {
  const config = getConfig();
  const cb = circuitBreakers.get(key) || { failures: 0, disabledUntil: 0 };
  cb.failures += 1;
  if (cb.failures >= config.AGENT_CIRCUIT_BREAKER_THRESHOLD) {
    cb.disabledUntil = Date.now() + config.AGENT_CIRCUIT_BREAKER_COOLDOWN_MS;
    logger.warn(`Circuit breaker tripped for ${key}, disabled until ${new Date(cb.disabledUntil).toISOString()}`);
  }
  circuitBreakers.set(key, cb);
}

function recordSuccess(key: string): void {
  circuitBreakers.delete(key);
}

// ─── Main Orchestration ──────────────────────────────────────────────────────

export async function executeAgent(opts: ExecuteAgentOptions): Promise<ExecuteAgentResult> {
  const startTime = Date.now();
  const config = getConfig();
  const cbKey = `${opts.tenantId}:${opts.agentSlug}`;

  // 1. Circuit breaker check
  if (isCircuitBroken(cbKey)) {
    logger.warn(`Agent "${opts.agentSlug}" circuit breaker open for tenant ${opts.tenantId}`);
    throw new Error(`Agent "${opts.agentSlug}" is temporarily disabled (circuit breaker)`);
  }

  // 2. Load definition
  const definition = await AgentDefinition.findOne({ slug: opts.agentSlug, is_active: true }).lean();
  if (!definition) {
    throw new Error(`Agent "${opts.agentSlug}" not found or inactive`);
  }

  // 3. Load installation
  const installation = await AgentInstallation.findOne({
    tenant_id: opts.tenantId,
    agent_slug: opts.agentSlug,
    enabled: true,
  }).lean();
  if (!installation) {
    throw new Error(`Agent "${opts.agentSlug}" not installed or disabled for tenant ${opts.tenantId}`);
  }

  // 4. Resolve effective config (merge consumer overrides if applicable)
  const effectiveConfig = resolveEffectiveConfig(installation, opts.consumerTenantId);
  const effectiveAutonomy = resolveEffectiveAutonomy(installation, opts.consumerTenantId);

  // 5. Check budget
  const currentPeriod = getCurrentPeriod();
  const usage = await AgentUsage.findOne({
    tenant_id: opts.tenantId,
    agent_slug: opts.agentSlug,
    period: currentPeriod,
  }).lean();

  if (usage) {
    if (effectiveConfig.monthly_token_budget > 0 &&
        (usage.input_tokens + usage.output_tokens) >= effectiveConfig.monthly_token_budget) {
      throw new Error(`Agent "${opts.agentSlug}" monthly token budget exceeded`);
    }
    if (effectiveConfig.monthly_cost_budget_cents > 0 &&
        usage.cost_cents >= effectiveConfig.monthly_cost_budget_cents) {
      throw new Error(`Agent "${opts.agentSlug}" monthly cost budget exceeded`);
    }
  }

  // 6. Create execution record
  const execution = await AgentExecution.create({
    tenant_id: opts.tenantId,
    consumer_tenant_id: opts.consumerTenantId,
    agent_slug: opts.agentSlug,
    installation_id: installation._id,
    trigger: opts.trigger,
    status: 'running',
    started_at: new Date(),
  });

  try {
    // 7. Build context
    const contextData = await buildAgentContext(
      opts.agentSlug,
      opts.tenantId,
      opts.trigger.source_id,
      opts.consumerTenantId
    );

    execution.context_summary = contextData.summary;

    // 8. Check if AI is available — either the platform-wide OpenAI key, or
    // this tenant's own configured provider (OpenAI/Anthropic/Google via
    // Settings → AI). Checking isAIAvailable() alone would fail every
    // execution for a tenant on tenant-level Anthropic/Google BYOK even
    // though generateToolUseCompletion below is able to serve them.
    if (!isAIAvailable() && !(await getClientForTenant(opts.tenantId))) {
      execution.status = 'failed';
      execution.outcome = {
        summary: 'AI service unavailable',
        success: false,
        error_message: 'No AI provider configured (neither platform OPENAI_API_KEY nor a tenant AI config)',
      };
      execution.duration_ms = Date.now() - startTime;
      await execution.save();
      return buildResult(execution);
    }

    // 9. Get prompt config
    const promptConfig = AGENT_PROMPTS[opts.agentSlug];
    if (!promptConfig) {
      throw new Error(`No prompt configuration for agent "${opts.agentSlug}"`);
    }

    // 10. Build system prompt with dynamic injections
    const systemPrompt = buildSystemPrompt(promptConfig, effectiveAutonomy, effectiveConfig, definition);

    // 11. Build user message from context
    const userMessage = buildUserMessage(contextData, opts.trigger);

    // 12. Get tool definitions for LLM
    const toolDefs = getToolDefinitionsForLLM(definition.capabilities);

    // 13. Call LLM
    const llmResult = await generateToolUseCompletion({
      system: systemPrompt,
      userMessage,
      tools: toolDefs.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
      model: definition.llm_config.primary_model,
      maxTokens: definition.llm_config.max_tokens,
      tenantId: opts.tenantId,
    });

    // 14. Store reasoning
    execution.reasoning = llmResult.text_blocks.join('\n\n');
    execution.token_usage = {
      input_tokens: llmResult.input_tokens,
      output_tokens: llmResult.output_tokens,
      model: llmResult.model,
    };

    // 14a. Fail immediately if AI is unconfigured or provider call failed
    if (llmResult.model === 'disabled' || llmResult.model === 'error') {
      execution.status = 'failed';
      execution.outcome = {
        summary: llmResult.model === 'disabled' ? 'AI not configured for this organization' : 'AI provider error',
        success: false,
        error_message: llmResult.model === 'disabled' ? 'ai_not_configured' : llmResult.text_blocks.join(' '),
      };
      execution.duration_ms = Date.now() - startTime;
      await execution.save();
      return buildResult(execution);
    }

    // 15. Compute cost
    const costCents = computeCost(llmResult.input_tokens, llmResult.output_tokens, config);
    execution.cost_cents = costCents;

    // 16. Process tool calls
    const actions: ExecutionAction[] = [];
    const recommendations: ExecutionRecommendation[] = [];

    for (const toolCall of llmResult.tool_calls) {
      // Map LLM tool name back to tool slug (underscores → dots)
      const toolSlug = toolCall.tool_name.replace(/_/g, '.');
      const toolRisk = getToolRiskLevel(toolSlug);

      // Check if action is blocked
      if (effectiveConfig.blocked_actions.includes(toolSlug)) {
        actions.push({
          action_type: toolSlug,
          description: `Blocked by configuration: ${toolSlug}`,
          risk_level: toolRisk,
          status: 'skipped',
        });
        continue;
      }

      // Determine action based on autonomy level
      const shouldExecute = determineAction(effectiveAutonomy, toolRisk, effectiveConfig.require_approval_above_risk);

      if (shouldExecute === 'execute') {
        // Auto-execute
        const tool = getTool(toolSlug);
        if (tool) {
          try {
            const result = await tool.execute(toolCall.tool_input, {
              tenant_id: opts.tenantId,
              consumer_tenant_id: opts.consumerTenantId,
              agent_slug: opts.agentSlug,
              execution_id: execution._id.toString(),
            });
            actions.push({
              action_type: toolSlug,
              description: JSON.stringify(toolCall.tool_input).substring(0, 500),
              target_id: toolCall.tool_input?.incident_id || toolCall.tool_input?.change_id || toolCall.tool_input?.thread_id,
              target_type: toolSlug.split('.')[0],
              risk_level: toolRisk,
              status: 'executed',
              result: result.data,
              executed_at: new Date(),
            });
          } catch (toolErr: any) {
            actions.push({
              action_type: toolSlug,
              description: `Execution failed: ${toolErr.message}`,
              risk_level: toolRisk,
              status: 'skipped',
              result: { error: toolErr.message },
            });
          }
        }
      } else if (shouldExecute === 'approve') {
        // Queue for approval
        const approval = await AgentApproval.create({
          tenant_id: opts.tenantId,
          consumer_tenant_id: opts.consumerTenantId,
          execution_id: execution._id,
          agent_slug: opts.agentSlug,
          action: {
            action_type: toolSlug,
            description: JSON.stringify(toolCall.tool_input).substring(0, 500),
            target_id: toolCall.tool_input?.incident_id || toolCall.tool_input?.change_id,
            target_type: toolSlug.split('.')[0],
            risk_level: toolRisk,
            reasoning: execution.reasoning.substring(0, 1000),
            context: toolCall.tool_input,
          },
          priority: toolRisk as any,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h expiry
        });

        actions.push({
          action_type: toolSlug,
          description: JSON.stringify(toolCall.tool_input).substring(0, 500),
          target_id: toolCall.tool_input?.incident_id || toolCall.tool_input?.change_id,
          target_type: toolSlug.split('.')[0],
          risk_level: toolRisk,
          status: 'pending_approval',
        });

        // Publish approval request
        try {
          const js = getJetStream();
          await js.publish(
            'agents.approval.request',
            sc.encode(JSON.stringify({ approval_id: approval._id, tenant_id: opts.tenantId }))
          );
        } catch { /* non-critical */ }
      } else {
        // Recommend only
        recommendations.push({
          action_type: toolSlug,
          description: JSON.stringify(toolCall.tool_input).substring(0, 500),
          reasoning: execution.reasoning.substring(0, 500),
          risk_level: toolRisk,
        });
      }
    }

    // 17. Finalize execution
    execution.actions_taken = actions;
    execution.recommendations = recommendations;
    execution.status = actions.some((a) => a.status === 'pending_approval')
      ? 'awaiting_approval'
      : 'completed';
    execution.outcome = {
      summary: `${actions.filter((a) => a.status === 'executed').length} actions executed, ${actions.filter((a) => a.status === 'pending_approval').length} awaiting approval, ${recommendations.length} recommendations`,
      success: true,
    };
    execution.completed_at = new Date();
    execution.duration_ms = Date.now() - startTime;
    await execution.save();

    // 18. Update usage
    await AgentUsage.findOneAndUpdate(
      { tenant_id: opts.tenantId, agent_slug: opts.agentSlug, period: currentPeriod },
      {
        $inc: {
          executions: 1,
          input_tokens: llmResult.input_tokens,
          output_tokens: llmResult.output_tokens,
          actions_executed: actions.filter((a) => a.status === 'executed').length,
          actions_recommended: recommendations.length,
          approvals_requested: actions.filter((a) => a.status === 'pending_approval').length,
          cost_cents: costCents,
        },
      },
      { upsert: true }
    );

    // 19. Publish result for agent chaining
    try {
      const js = getJetStream();
      await js.publish(
        `agents.result.${opts.agentSlug}`,
        sc.encode(JSON.stringify({
          execution_id: execution._id,
          agent_slug: opts.agentSlug,
          tenant_id: opts.tenantId,
          status: execution.status,
          actions_count: actions.length,
          recommendations_count: recommendations.length,
        }))
      );
    } catch { /* non-critical */ }

    recordSuccess(cbKey);
    return buildResult(execution);
  } catch (err: any) {
    // Handle execution failure
    recordFailure(cbKey);
    execution.status = 'failed';
    execution.outcome = {
      summary: `Execution failed: ${err.message}`,
      success: false,
      error_message: err.message,
    };
    execution.duration_ms = Date.now() - startTime;
    execution.completed_at = new Date();
    await execution.save();

    logger.error(`Agent execution failed: ${opts.agentSlug}`, {
      tenantId: opts.tenantId,
      error: err.message,
      executionId: execution._id.toString(),
    });

    return buildResult(execution);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveEffectiveConfig(
  installation: any,
  consumerTenantId?: string
): AgentConfiguration {
  const base = installation.configuration;
  if (!consumerTenantId || !installation.consumer_overrides?.length) return base;

  const override = installation.consumer_overrides.find(
    (o: any) => o.consumer_tenant_id.toString() === consumerTenantId
  );
  if (!override?.configuration) return base;

  return { ...base, ...override.configuration };
}

function resolveEffectiveAutonomy(
  installation: any,
  consumerTenantId?: string
): AutonomyLevel {
  if (!consumerTenantId || !installation.consumer_overrides?.length) {
    return installation.autonomy_level;
  }
  const override = installation.consumer_overrides.find(
    (o: any) => o.consumer_tenant_id.toString() === consumerTenantId
  );
  return override?.autonomy_level || installation.autonomy_level;
}

function determineAction(
  autonomy: AutonomyLevel,
  actionRisk: string,
  approvalThreshold: string
): 'execute' | 'approve' | 'recommend' {
  switch (autonomy) {
    case 'observe':
    case 'recommend':
      return 'recommend';
    case 'auto_low':
      if (riskMeetsThreshold(actionRisk, approvalThreshold)) return 'approve';
      if (actionRisk === 'low') return 'execute';
      return 'approve';
    case 'auto_full':
      if (riskMeetsThreshold(actionRisk, approvalThreshold)) return 'approve';
      return 'execute';
    default:
      return 'recommend';
  }
}

function buildSystemPrompt(
  promptConfig: { system_prompt: string; output_instructions: string },
  autonomy: AutonomyLevel,
  config: AgentConfiguration,
  definition: any
): string {
  const blockedList = config.blocked_actions.length
    ? config.blocked_actions.join(', ')
    : 'none';

  return `${promptConfig.system_prompt}

AUTONOMY LEVEL: ${autonomy}
${autonomy === 'observe' ? '- You are in OBSERVE mode. Do NOT use any tools. Only analyze and report findings.' : ''}
${autonomy === 'recommend' ? '- You are in RECOMMEND mode. Do NOT use any tools. Instead, describe what actions you would take and why.' : ''}
${autonomy === 'auto_low' ? '- You are in AUTO_LOW mode. You may use tools for low-risk actions. Medium/high/critical actions will be queued for human approval.' : ''}
${autonomy === 'auto_full' ? '- You are in AUTO_FULL mode. You may use tools for all actions, but actions above the configured risk threshold will still require approval.' : ''}

BLOCKED ACTIONS: ${blockedList}
MAX ACTIONS PER EXECUTION: ${config.max_actions_per_execution}

${promptConfig.output_instructions}`;
}

function buildUserMessage(
  contextData: { summary: string; details: Record<string, any> },
  trigger: { type: string; event_type?: string; source_id?: string }
): string {
  return `TRIGGER: ${trigger.type}${trigger.event_type ? ` (${trigger.event_type})` : ''}
SOURCE: ${trigger.source_id || 'N/A'}

CONTEXT:
${contextData.summary}

DETAILS:
${JSON.stringify(contextData.details, null, 2)}

Please analyze this context and take appropriate action based on your role and autonomy level.`;
}

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function computeCost(inputTokens: number, outputTokens: number, config: any): number {
  const inputCost = Math.ceil((inputTokens / 1_000_000) * config.AGENT_TOKEN_COST_PER_MILLION_INPUT);
  const outputCost = Math.ceil((outputTokens / 1_000_000) * config.AGENT_TOKEN_COST_PER_MILLION_OUTPUT);
  return inputCost + outputCost;
}

function buildResult(execution: AgentExecutionDocument): ExecuteAgentResult {
  return {
    execution_id: execution._id.toString(),
    status: execution.status,
    actions_taken: execution.actions_taken?.length || 0,
    recommendations: execution.recommendations?.length || 0,
    cost_cents: execution.cost_cents,
  };
}
