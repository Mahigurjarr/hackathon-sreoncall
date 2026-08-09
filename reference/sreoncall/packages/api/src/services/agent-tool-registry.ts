import { z, ZodSchema } from 'zod';
import { Types } from 'mongoose';
import { logger } from '../utils/logger';
import mongoose from 'mongoose';
import * as incidentService from './incident.service';
import { createTicket } from './ticket.service';
import { createPostmortem, updatePostmortem } from './postmortem.service';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface AgentContext {
  tenant_id: string;
  consumer_tenant_id?: string;
  user_id?: string;
  agent_slug: string;
  execution_id: string;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface AgentTool {
  slug: string;
  display_name: string;
  description: string;
  risk_level: ToolRiskLevel;
  parameters: ZodSchema;
  execute: (params: any, context: AgentContext) => Promise<ToolResult>;
}

export interface ToolDefinitionForLLM {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

// ─── Registry ────────────────────────────────────────────────────────────────

const tools = new Map<string, AgentTool>();

export function registerTool(tool: AgentTool): void {
  if (tools.has(tool.slug)) {
    logger.warn(`Agent tool "${tool.slug}" already registered, overwriting`);
  }
  tools.set(tool.slug, tool);
}

export function getTool(slug: string): AgentTool | undefined {
  return tools.get(slug);
}

export function getToolsForAgent(capabilities: string[]): AgentTool[] {
  return capabilities
    .map((slug) => tools.get(slug))
    .filter((t): t is AgentTool => !!t);
}

export function getToolDefinitionsForLLM(capabilities: string[]): ToolDefinitionForLLM[] {
  return getToolsForAgent(capabilities).map((tool) => ({
    name: tool.slug.replace(/\./g, '_'),
    description: tool.description,
    input_schema: zodToJsonSchema(tool.parameters),
  }));
}

export function getToolRiskLevel(slug: string): ToolRiskLevel {
  return tools.get(slug)?.risk_level ?? 'high';
}

export function getAllTools(): AgentTool[] {
  return Array.from(tools.values());
}

// ─── Zod → JSON Schema helper (simplified) ──────────────────────────────────

function zodToJsonSchema(schema: ZodSchema): Record<string, any> {
  // For tool use with Claude, we produce a minimal JSON Schema.
  // In production this would use zod-to-json-schema, but we keep it simple.
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodVal = value as z.ZodTypeAny;
      properties[key] = zodFieldToJsonSchema(zodVal);
      if (!zodVal.isOptional()) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  return { type: 'object', properties: {} };
}

function zodFieldToJsonSchema(field: z.ZodTypeAny): Record<string, any> {
  if (field instanceof z.ZodString) return { type: 'string' };
  if (field instanceof z.ZodNumber) return { type: 'number' };
  if (field instanceof z.ZodBoolean) return { type: 'boolean' };
  if (field instanceof z.ZodEnum) return { type: 'string', enum: field.options };
  if (field instanceof z.ZodArray) return { type: 'array', items: zodFieldToJsonSchema(field.element) };
  if (field instanceof z.ZodOptional) return zodFieldToJsonSchema(field.unwrap());
  if (field instanceof z.ZodDefault) return zodFieldToJsonSchema(field.removeDefault());
  return { type: 'string' };
}

// ─── Register built-in tools ─────────────────────────────────────────────────

function registerBuiltinTools(): void {
  // Incident tools
  registerTool({
    slug: 'incident.create',
    display_name: 'Create Incident',
    description: 'Create a new incident with title, severity, and affected services.',
    risk_level: 'medium',
    parameters: z.object({
      title: z.string().describe('Incident title'),
      severity: z.number().min(1).max(5).describe('Severity level (1=critical, 5=info)'),
      description: z.string().optional().describe('Incident description'),
      service_ids: z.array(z.string()).optional().describe('Affected service IDs'),
    }),
    execute: async (params, context) => {
      try {
        const tenantId = new Types.ObjectId(context.tenant_id);
        const actorId = new Types.ObjectId('000000000000000000000000');
        const inc = await incidentService.createIncident({
          tenant_id: tenantId,
          title: `[AI Agent] ${params.title}`,
          description: params.description || '',
          severity: params.severity as 1 | 2 | 3 | 4 | 5,
          source: 'ai',
          created_by: actorId,
          affected_service_ids: params.service_ids || [],
        });
        return { success: true, data: { incident_id: inc._id.toString(), number: inc.number } };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  });

  registerTool({
    slug: 'incident.update',
    display_name: 'Update Incident',
    description: 'Update an existing incident (status, severity, description).',
    risk_level: 'medium',
    parameters: z.object({
      incident_id: z.string().describe('Incident ID to update'),
      status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']).optional(),
      severity: z.number().min(1).max(5).optional(),
      description: z.string().optional(),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'incident.update', params } };
    },
  });

  registerTool({
    slug: 'incident.update_severity',
    display_name: 'Update Incident Severity',
    description: 'Change the severity level of an incident.',
    risk_level: 'high',
    parameters: z.object({
      incident_id: z.string().describe('Incident ID'),
      severity: z.number().min(1).max(5).describe('New severity level'),
      reason: z.string().describe('Reason for severity change'),
    }),
    execute: async (params, context) => {
      try {
        const tenantId = new Types.ObjectId(context.tenant_id);
        const actorId = new Types.ObjectId('000000000000000000000000');
        const inc = await incidentService.changeSeverity(
          tenantId, params.incident_id, params.severity, actorId,
          `[AI Agent: ${context.agent_slug}] ${params.reason}`
        );
        return { success: true, data: { incident_id: inc._id.toString(), severity: inc.severity } };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  });

  registerTool({
    slug: 'incident.add_responder',
    display_name: 'Add Incident Responder',
    description: 'Add a responder to an active incident.',
    risk_level: 'low',
    parameters: z.object({
      incident_id: z.string().describe('Incident ID'),
      user_id: z.string().describe('User ID of the responder'),
      role: z.enum(['commander', 'communications', 'operations', 'responder']).optional(),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'incident.add_responder', params } };
    },
  });

  registerTool({
    slug: 'incident.add_timeline_entry',
    display_name: 'Add Timeline Entry',
    description: 'Add an entry to the incident timeline for tracking investigation progress.',
    risk_level: 'low',
    parameters: z.object({
      incident_id: z.string().describe('Incident ID'),
      message: z.string().describe('Timeline entry message'),
      entry_type: z.enum(['note', 'action', 'update', 'escalation']).optional(),
    }),
    execute: async (params, context) => {
      try {
        const tenantId = new Types.ObjectId(context.tenant_id);
        // Use a system actor ID (all zeros) for agent actions
        const actorId = new Types.ObjectId('000000000000000000000000');
        const type = params.entry_type || 'note';
        const inc = await incidentService.addTimelineEntry(
          tenantId, params.incident_id, actorId,
          `[AI Agent: ${context.agent_slug}] ${params.message}`, type as any,
          { source: 'agent', agent_slug: context.agent_slug, execution_id: context.execution_id }
        );
        return { success: true, data: { incident_id: inc._id.toString(), timeline_count: inc.timeline.length } };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  });

  registerTool({
    slug: 'incident.acknowledge',
    display_name: 'Acknowledge Incident',
    description: 'Acknowledge an incident to indicate it is being worked on.',
    risk_level: 'low',
    parameters: z.object({
      incident_id: z.string().describe('Incident ID to acknowledge'),
    }),
    execute: async (params, context) => {
      try {
        const tenantId = new Types.ObjectId(context.tenant_id);
        const actorId = new Types.ObjectId('000000000000000000000000');
        const inc = await incidentService.acknowledgeIncident(tenantId, params.incident_id, actorId);
        return { success: true, data: { incident_id: inc._id.toString(), status: inc.status } };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  });

  registerTool({
    slug: 'incident.resolve',
    display_name: 'Resolve Incident',
    description: 'Mark an incident as resolved.',
    risk_level: 'high',
    parameters: z.object({
      incident_id: z.string().describe('Incident ID to resolve'),
      resolution_summary: z.string().describe('Summary of how the incident was resolved'),
    }),
    execute: async (params, context) => {
      try {
        const tenantId = new Types.ObjectId(context.tenant_id);
        const actorId = new Types.ObjectId('000000000000000000000000');
        const inc = await incidentService.resolveIncident(
          tenantId, params.incident_id, actorId, params.resolution_summary
        );
        return { success: true, data: { incident_id: inc._id.toString(), status: inc.status } };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  });

  // Ticket tools
  registerTool({
    slug: 'ticket.create',
    display_name: 'Create Ticket',
    description: 'Create a work ticket for follow-up action items.',
    risk_level: 'low',
    parameters: z.object({
      title: z.string().describe('Ticket title'),
      description: z.string().optional().describe('Ticket description'),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    }),
    execute: async (params, context) => {
      try {
        const tenantId = new Types.ObjectId(context.tenant_id);
        const actorId = new Types.ObjectId('000000000000000000000000');
        // Find default project for this tenant
        const Project = mongoose.model('Project');
        const project = await Project.findOne({ tenant_id: tenantId }).sort({ created_at: 1 }).lean();
        if (!project) return { success: false, error: 'No project found for tenant' };
        const ticket = await createTicket({
          tenant_id: tenantId,
          project_id: (project as any)._id.toString(),
          type: 'task',
          title: `[AI Agent] ${params.title}`,
          description: params.description || '',
          priority: params.priority || 'medium',
          reporter_id: actorId,
          labels: ['ai-generated', context.agent_slug],
        });
        return { success: true, data: { ticket_id: ticket._id.toString(), number: ticket.number } };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  });

  // Notification tools
  registerTool({
    slug: 'notification.send',
    display_name: 'Send Notification',
    description: 'Send a notification to specific users or teams.',
    risk_level: 'low',
    parameters: z.object({
      user_ids: z.array(z.string()).optional().describe('User IDs to notify'),
      team_id: z.string().optional().describe('Team ID to notify'),
      title: z.string().describe('Notification title'),
      body: z.string().describe('Notification body'),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'notification.send', params } };
    },
  });

  // Runbook tools
  registerTool({
    slug: 'runbook.suggest',
    display_name: 'Suggest Runbook',
    description: 'Suggest a relevant runbook for the current incident based on symptoms and affected services.',
    risk_level: 'low',
    parameters: z.object({
      incident_id: z.string().describe('Incident ID'),
      runbook_id: z.string().describe('Suggested runbook ID'),
      reason: z.string().describe('Why this runbook is relevant'),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'runbook.suggest', params } };
    },
  });

  registerTool({
    slug: 'runbook.execute',
    display_name: 'Execute Runbook',
    description: 'Execute a runbook to remediate an issue. This runs automated steps.',
    risk_level: 'critical',
    parameters: z.object({
      runbook_id: z.string().describe('Runbook ID to execute'),
      incident_id: z.string().optional().describe('Associated incident ID'),
      parameters: z.record(z.string()).optional().describe('Runbook parameters'),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'runbook.execute', params } };
    },
  });

  // Escalation tools
  registerTool({
    slug: 'escalation.trigger',
    display_name: 'Trigger Escalation',
    description: 'Escalate an incident to the next level in the escalation policy.',
    risk_level: 'high',
    parameters: z.object({
      incident_id: z.string().describe('Incident ID to escalate'),
      reason: z.string().describe('Reason for escalation'),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'escalation.trigger', params } };
    },
  });

  // Status page tools
  registerTool({
    slug: 'status_page.draft_update',
    display_name: 'Draft Status Page Update',
    description: 'Draft a status page update for an ongoing incident.',
    risk_level: 'medium',
    parameters: z.object({
      status_page_id: z.string().describe('Status page ID'),
      incident_id: z.string().optional().describe('Related incident ID'),
      title: z.string().describe('Update title'),
      body: z.string().describe('Update body (customer-facing language)'),
      status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']).optional(),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'status_page.draft_update', params } };
    },
  });

  registerTool({
    slug: 'status_page.publish_update',
    display_name: 'Publish Status Page Update',
    description: 'Publish a status page update visible to all subscribers.',
    risk_level: 'high',
    parameters: z.object({
      status_page_id: z.string().describe('Status page ID'),
      update_id: z.string().describe('Draft update ID to publish'),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'status_page.publish_update', params } };
    },
  });

  // Change management tools
  registerTool({
    slug: 'change.update_risk_score',
    display_name: 'Update Change Risk Score',
    description: 'Set the AI-computed risk score for a change request.',
    risk_level: 'low',
    parameters: z.object({
      change_id: z.string().describe('Change request ID'),
      risk_score: z.enum(['low', 'medium', 'high', 'critical']).describe('Computed risk score'),
      reasoning: z.string().describe('Risk assessment reasoning'),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'change.update_risk_score', params } };
    },
  });

  registerTool({
    slug: 'change.approve',
    display_name: 'Approve Change Request',
    description: 'Auto-approve a low-risk standard change request.',
    risk_level: 'high',
    parameters: z.object({
      change_id: z.string().describe('Change request ID to approve'),
      reason: z.string().describe('Reason for approval'),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'change.approve', params } };
    },
  });

  // Postmortem tools
  registerTool({
    slug: 'postmortem.create_draft',
    display_name: 'Create Postmortem Draft',
    description: 'Create a draft postmortem document from incident data.',
    risk_level: 'low',
    parameters: z.object({
      incident_id: z.string().describe('Incident ID to create postmortem for'),
      title: z.string().describe('Postmortem title'),
      summary: z.string().describe('Executive summary'),
      root_cause: z.string().describe('Root cause analysis'),
      contributing_factors: z.array(z.string()).optional().describe('Contributing factors'),
      action_items: z.array(z.string()).optional().describe('Follow-up action items'),
    }),
    execute: async (params, context) => {
      try {
        const tenantId = new Types.ObjectId(context.tenant_id);
        const actorId = new Types.ObjectId('000000000000000000000000');
        const pm = await createPostmortem({
          tenant_id: tenantId,
          author_id: actorId,
          title: params.title,
          summary: params.summary,
          incident_id: params.incident_id,
        });
        // Fill in root cause and action items
        await updatePostmortem(tenantId, pm._id.toString(), {
          root_cause: params.root_cause,
          contributing_factors: (params.contributing_factors || []).map((f: string) => ({ description: f })),
          action_items: (params.action_items || []).map((a: string) => ({
            title: a, status: 'open', priority: 'medium',
          })),
        });
        return { success: true, data: { postmortem_id: pm._id.toString() } };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  });

  // Communication tools
  registerTool({
    slug: 'thread.draft_reply',
    display_name: 'Draft Communication Reply',
    description: 'Draft a reply in the unified communication hub thread.',
    risk_level: 'medium',
    parameters: z.object({
      thread_id: z.string().describe('Communication thread ID'),
      body: z.string().describe('Reply message body'),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'thread.draft_reply', params } };
    },
  });

  // On-call tools
  registerTool({
    slug: 'oncall_schedule.suggest_override',
    display_name: 'Suggest On-Call Override',
    description: 'Suggest an on-call schedule override for load balancing or coverage.',
    risk_level: 'low',
    parameters: z.object({
      schedule_id: z.string().describe('On-call schedule ID'),
      suggested_user_id: z.string().describe('Suggested replacement user'),
      reason: z.string().describe('Reason for override suggestion'),
      start_time: z.string().describe('Override start time (ISO 8601)'),
      end_time: z.string().describe('Override end time (ISO 8601)'),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'oncall_schedule.suggest_override', params } };
    },
  });

  // Alert tools
  registerTool({
    slug: 'alert.correlate',
    display_name: 'Correlate Alerts',
    description: 'Group related alerts into a single incident.',
    risk_level: 'medium',
    parameters: z.object({
      alert_ids: z.array(z.string()).describe('Alert IDs to correlate'),
      incident_title: z.string().describe('Title for the correlated incident'),
      severity: z.number().min(1).max(5).describe('Incident severity'),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'alert.correlate', params } };
    },
  });

  registerTool({
    slug: 'alert.suppress',
    display_name: 'Suppress Alert',
    description: 'Suppress a noisy or flapping alert with a reason.',
    risk_level: 'medium',
    parameters: z.object({
      alert_rule_id: z.string().describe('Alert rule ID to suppress'),
      duration_minutes: z.number().min(5).max(1440).describe('Suppression duration in minutes'),
      reason: z.string().describe('Reason for suppression'),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'alert.suppress', params } };
    },
  });

  registerTool({
    slug: 'alert_rule.suggest_update',
    display_name: 'Suggest Alert Rule Update',
    description: 'Suggest threshold or configuration changes for an alert rule.',
    risk_level: 'low',
    parameters: z.object({
      alert_rule_id: z.string().describe('Alert rule ID'),
      suggestion: z.string().describe('Suggested change description'),
      current_threshold: z.string().optional().describe('Current threshold value'),
      suggested_threshold: z.string().optional().describe('Suggested threshold value'),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'alert_rule.suggest_update', params } };
    },
  });

  registerTool({
    slug: 'slo.suggest',
    display_name: 'Suggest SLO',
    description: 'Suggest an SLO definition for a service based on historical data.',
    risk_level: 'low',
    parameters: z.object({
      service_id: z.string().describe('Service ID'),
      sli_type: z.string().describe('SLI type (availability, latency, etc.)'),
      target: z.number().describe('Suggested target (e.g., 99.9)'),
      reasoning: z.string().describe('Why this target is appropriate'),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'slo.suggest', params } };
    },
  });

  // Change conflict/window tools
  registerTool({
    slug: 'change.add_conflict_warning',
    display_name: 'Add Change Conflict Warning',
    description: 'Flag a potential conflict between overlapping change requests.',
    risk_level: 'low',
    parameters: z.object({
      change_id: z.string().describe('Change request ID'),
      conflicting_change_id: z.string().describe('Conflicting change request ID'),
      warning: z.string().describe('Description of the conflict'),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'change.add_conflict_warning', params } };
    },
  });

  // Incident-change linking tool (Phase 2: RCA Agent)
  registerTool({
    slug: 'incident.link_change',
    display_name: 'Link Change to Incident',
    description: 'Link a change request as the probable cause of an incident.',
    risk_level: 'medium',
    parameters: z.object({
      incident_id: z.string().describe('Incident ID'),
      change_id: z.string().describe('Change request ID identified as probable cause'),
      confidence: z.number().min(0).max(1).describe('Confidence score (0-1)'),
      reasoning: z.string().describe('Why this change is the probable cause'),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'incident.link_change', params } };
    },
  });

  registerTool({
    slug: 'change.suggest_window',
    display_name: 'Suggest Change Window',
    description: 'Suggest an optimal implementation window for a change request.',
    risk_level: 'low',
    parameters: z.object({
      change_id: z.string().describe('Change request ID'),
      suggested_start: z.string().describe('Suggested start time (ISO 8601)'),
      suggested_end: z.string().describe('Suggested end time (ISO 8601)'),
      reasoning: z.string().describe('Why this window is optimal'),
    }),
    execute: async (params, context) => {
      return { success: true, data: { action: 'change.suggest_window', params } };
    },
  });
}

// Initialize on import
registerBuiltinTools();
