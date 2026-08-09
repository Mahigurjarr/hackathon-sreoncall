import {
  AckPolicy,
  DeliverPolicy,
  JetStreamClient,
  JetStreamManager,
  ConsumerMessages,
} from 'nats';
import { getJetStream, getJetStreamManager } from '../config/nats';
import { executeAgent } from '../services/agent-orchestrator.service';
import { AgentApproval } from '../models/agent-approval.model';
import { AgentExecution } from '../models/agent-execution.model';
import { AgentUsage } from '../models/agent-usage.model';
import { getTool } from '../services/agent-tool-registry';
import { logger } from '../utils/logger';

let running = false;
let triggerConsumer: ConsumerMessages | null = null;
let approvalConsumer: ConsumerMessages | null = null;

// ─── Trigger Consumer ────────────────────────────────────────────────────────

async function ensureTriggerConsumer(jsm: JetStreamManager): Promise<void> {
  try {
    await jsm.consumers.info('AGENTS', 'agent-trigger-processor');
  } catch {
    await jsm.consumers.add('AGENTS', {
      durable_name: 'agent-trigger-processor',
      filter_subject: 'agents.trigger.>',
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.New,
      max_deliver: 3,
      ack_wait: 60_000_000_000, // 60s in nanoseconds
    });
  }
}

async function processTriggers(js: JetStreamClient): Promise<void> {
  triggerConsumer = await js.consumers.get('AGENTS', 'agent-trigger-processor').then((c) => c.consume());
  if (!triggerConsumer) return;

  for await (const msg of triggerConsumer) {
    if (!running) break;

    try {
      const payload = JSON.parse(new TextDecoder().decode(msg.data));
      const { agent_slug, trigger, tenant_id, consumer_tenant_id, context } = payload;

      logger.info(`Agent trigger received: ${agent_slug}`, {
        tenantId: tenant_id,
        triggerType: trigger.type,
        eventType: trigger.event_type,
      });

      await executeAgent({
        agentSlug: agent_slug,
        trigger,
        tenantId: tenant_id,
        consumerTenantId: consumer_tenant_id,
        context,
      });

      msg.ack();
    } catch (err: any) {
      logger.error('Agent trigger processing failed', { error: err.message });
      msg.nak(10_000); // 10s backoff
    }
  }
}

// ─── Approval Decision Consumer ──────────────────────────────────────────────

async function ensureApprovalConsumer(jsm: JetStreamManager): Promise<void> {
  try {
    await jsm.consumers.info('AGENTS', 'agent-approval-processor');
  } catch {
    await jsm.consumers.add('AGENTS', {
      durable_name: 'agent-approval-processor',
      filter_subject: 'agents.approval.decision',
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.New,
      max_deliver: 3,
      ack_wait: 30_000_000_000, // 30s
    });
  }
}

async function processApprovals(js: JetStreamClient): Promise<void> {
  approvalConsumer = await js.consumers.get('AGENTS', 'agent-approval-processor').then((c) => c.consume());
  if (!approvalConsumer) return;

  for await (const msg of approvalConsumer) {
    if (!running) break;

    try {
      const payload = JSON.parse(new TextDecoder().decode(msg.data));
      const { approval_id, decision } = payload;

      const approval = await AgentApproval.findById(approval_id);
      if (!approval || approval.status !== 'pending') {
        msg.ack();
        continue;
      }

      if (decision === 'approved') {
        // Execute the pending action
        const tool = getTool(approval.action.action_type);
        if (tool) {
          try {
            const result = await tool.execute(approval.action.context || {}, {
              tenant_id: approval.tenant_id.toString(),
              consumer_tenant_id: approval.consumer_tenant_id?.toString(),
              agent_slug: approval.agent_slug,
              execution_id: approval.execution_id.toString(),
            });

            // Update the execution's action status
            await AgentExecution.updateOne(
              {
                _id: approval.execution_id,
                'actions_taken.action_type': approval.action.action_type,
                'actions_taken.status': 'pending_approval',
              },
              {
                $set: {
                  'actions_taken.$.status': 'approved',
                  'actions_taken.$.result': result.data,
                  'actions_taken.$.executed_at': new Date(),
                },
              }
            );

            // Update usage counters
            const period = getCurrentPeriod();
            await AgentUsage.findOneAndUpdate(
              { tenant_id: approval.tenant_id, agent_slug: approval.agent_slug, period },
              { $inc: { approvals_approved: 1, actions_executed: 1 } },
              { upsert: true }
            );
          } catch (toolErr: any) {
            logger.error('Approved action execution failed', { error: toolErr.message, approvalId: approval_id });
          }
        }

        approval.status = 'approved';
      } else {
        // Update the execution's action status to rejected
        await AgentExecution.updateOne(
          {
            _id: approval.execution_id,
            'actions_taken.action_type': approval.action.action_type,
            'actions_taken.status': 'pending_approval',
          },
          { $set: { 'actions_taken.$.status': 'rejected' } }
        );

        const period = getCurrentPeriod();
        await AgentUsage.findOneAndUpdate(
          { tenant_id: approval.tenant_id, agent_slug: approval.agent_slug, period },
          { $inc: { approvals_rejected: 1 } },
          { upsert: true }
        );

        approval.status = 'rejected';
      }

      approval.decided_at = new Date();
      await approval.save();

      // Check if execution has any remaining pending approvals
      const execution = await AgentExecution.findById(approval.execution_id);
      if (execution && execution.status === 'awaiting_approval') {
        const hasPending = execution.actions_taken.some((a) => a.status === 'pending_approval');
        if (!hasPending) {
          execution.status = 'completed';
          execution.completed_at = new Date();
          await execution.save();
        }
      }

      msg.ack();
    } catch (err: any) {
      logger.error('Agent approval processing failed', { error: err.message });
      msg.nak(5_000);
    }
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export async function startAgentWorker(): Promise<void> {
  running = true;
  const js = getJetStream();
  const jsm = getJetStreamManager();

  await ensureTriggerConsumer(jsm);
  await ensureApprovalConsumer(jsm);

  // Start both consumers in parallel
  processTriggers(js).catch((err) => {
    if (running) logger.error('Agent trigger consumer crashed', { error: err.message });
  });

  processApprovals(js).catch((err) => {
    if (running) logger.error('Agent approval consumer crashed', { error: err.message });
  });

  logger.info('Agent worker started (trigger + approval consumers)');
}

export async function stopAgentWorker(): Promise<void> {
  running = false;
  if (triggerConsumer) {
    try { await triggerConsumer.stop(); } catch { /* ignore */ }
    triggerConsumer = null;
  }
  if (approvalConsumer) {
    try { await approvalConsumer.stop(); } catch { /* ignore */ }
    approvalConsumer = null;
  }
  logger.info('Agent worker stopped');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
