import { z } from 'zod';
import { Types } from 'mongoose';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hasFlatPermission } from '../middleware/rbac.middleware';
import * as incidentService from '../services/incident.service';
import * as ticketService from '../services/ticket.service';
import * as alertRuleService from '../services/alert-rule.service';
import * as oncallService from '../services/oncall.service';
import * as runbookService from '../services/runbook.service';
import * as statusPageService from '../services/status-page.service';
import * as mcpProposalService from '../services/mcp-proposal.service';
import * as escalationPolicyService from '../services/escalation-policy.service';
import * as oncallScheduleService from '../services/oncall-schedule.service';
import * as serviceDependencyService from '../services/service-dependency.service';
import * as postmortemService from '../services/postmortem.service';
import * as teamService from '../services/team.service';
import * as channelService from '../services/channel.service';
import { createAuditLog } from '../services/audit.service';
import { resolveEndpoints as resolveObservabilityEndpoints, proxyFetch as proxyObservabilityFetch } from '../routes/observability-proxy.routes';
import { SloDefinition } from '../models/slo-definition.model';
import { User } from '../models/user.model';
import { Service } from '../models/service.model';

export interface McpToolContext {
  tenantId: Types.ObjectId;
  apiKeyId: Types.ObjectId;
  permissions: string[];
  ip: string;
  userAgent: string;
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function textResult(data: unknown): ToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

const MAX_METRIC_SERIES = 100;
const MAX_SAMPLES_PER_SERIES = 500;

/**
 * Every other list tool caps its result (a zod-bounded `limit`, or an
 * explicit slice like get_incident's timeline); query_metrics passes a raw
 * PromQL query straight through with no such guard, so a broad/high-
 * cardinality query returns an unbounded result. Bounds the Prometheus
 * query/query_range response shape without touching anything else in it.
 */
function capMetricsResult(data: unknown): unknown {
  const result = (data as any)?.data?.result;
  if (!Array.isArray(result)) return data;

  const capped = result.slice(0, MAX_METRIC_SERIES).map((series: any) => {
    if (!Array.isArray(series?.values) || series.values.length <= MAX_SAMPLES_PER_SERIES) return series;
    return { ...series, values: series.values.slice(-MAX_SAMPLES_PER_SERIES), truncated_samples: true };
  });

  return {
    ...(data as any),
    data: { ...(data as any).data, result: capped },
    ...(result.length > MAX_METRIC_SERIES
      ? { truncated_series: true, total_series: result.length }
      : {}),
  };
}

function forbiddenResult(permission: string): ToolResult {
  return {
    content: [{ type: 'text' as const, text: `Missing permission on this API key: ${permission}` }],
    isError: true,
  };
}

function requirePermission(ctx: McpToolContext, permission: string): boolean {
  return hasFlatPermission(ctx.permissions, permission);
}

/**
 * Wraps a tool handler so every invocation writes an audit-log entry —
 * MCP tool calls otherwise leave no trail at all, since `/mcp` is a single
 * POST route carrying many distinct JSON-RPC tool calls in one request body,
 * so per-route `auditMiddleware` can't see individual tool invocations.
 * Fire-and-forget, matching the existing auditMiddleware pattern — an audit
 * write failure must never fail (or delay) the tool call itself.
 */
function auditTool<A>(
  ctx: McpToolContext,
  toolName: string,
  resourceType: string,
  handler: (args: A) => Promise<ToolResult>,
): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    const logResult = (result: 'success' | 'failure') => {
      createAuditLog({
        tenant_id: ctx.tenantId,
        actor: { type: 'api_key', id: ctx.apiKeyId, ip: ctx.ip, user_agent: ctx.userAgent },
        action: toolName,
        resource_type: resourceType,
        result,
      }).catch(() => {});
    };
    try {
      const result = await handler(args);
      logResult(result.isError ? 'failure' : 'success');
      return result;
    } catch (err) {
      logResult('failure');
      throw err;
    }
  };
}

/**
 * Registers every MCP tool this server exposes against one McpServer
 * instance, scoped to a single request's tenant + API-key permissions.
 *
 * Two categories only, by design (see roadmap "AI-native" §1 — one approval
 * primitive used everywhere): read tools query real data directly; propose_*
 * tools NEVER call a creation service directly — they only ever create an
 * McpProposal for a human to review in-app. There is no third category.
 */
export function registerTools(server: McpServer, ctx: McpToolContext): void {
  // ─── Read tools ────────────────────────────────────────────────────────────

  server.registerTool(
    'list_incidents',
    {
      title: 'List incidents',
      description: 'List incidents for this organization, optionally filtered by status or severity.',
      inputSchema: {
        status: z.enum(['open', 'acknowledged', 'investigating', 'monitoring', 'resolved', 'closed']).optional(),
        severity: z.number().int().min(1).max(5).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    auditTool(ctx, 'list_incidents', 'incident', async (args) => {
      if (!requirePermission(ctx, 'incidents:read')) return forbiddenResult('incidents:read');
      const result = await incidentService.listIncidents(
        { tenant_id: ctx.tenantId, status: args.status as string | undefined, severity: args.severity as number | undefined },
        { limit: (args.limit as number | undefined) ?? 20 },
      );
      return textResult(
        result.data.map((i: any) => ({
          id: i._id.toString(),
          number: i.number,
          title: i.title,
          severity: i.severity,
          status: i.status,
          created_at: i.createdAt,
        })),
      );
    }),
  );

  server.registerTool(
    'get_incident',
    {
      title: 'Get incident',
      description: 'Get full detail for a single incident by id.',
      inputSchema: { id: z.string() },
    },
    auditTool(ctx, 'get_incident', 'incident', async (args) => {
      if (!requirePermission(ctx, 'incidents:read')) return forbiddenResult('incidents:read');
      const incident: any = await incidentService.getIncidentById(ctx.tenantId, args.id as string);
      return textResult({
        id: incident._id.toString(),
        number: incident.number,
        title: incident.title,
        description: incident.description,
        severity: incident.severity,
        status: incident.status,
        timeline: (incident.timeline ?? []).slice(-20),
        metrics: incident.metrics,
        created_at: incident.createdAt,
      });
    }),
  );

  server.registerTool(
    'list_tickets',
    {
      title: 'List tickets',
      description: 'List tickets for this organization, optionally filtered by status, priority, or project.',
      inputSchema: {
        status: z.string().optional(),
        priority: z.string().optional(),
        project_id: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    auditTool(ctx, 'list_tickets', 'ticket', async (args) => {
      if (!requirePermission(ctx, 'tickets:read')) return forbiddenResult('tickets:read');
      const result = await ticketService.listTickets(
        {
          tenant_id: ctx.tenantId,
          status: args.status as string | undefined,
          priority: args.priority as string | undefined,
          project_id: args.project_id as string | undefined,
        },
        { limit: (args.limit as number | undefined) ?? 20 },
      );
      return textResult(
        result.data.map((t: any) => ({
          id: t._id.toString(),
          number: t.number,
          title: t.title,
          type: t.type,
          status: t.status,
          priority: t.priority,
          created_at: t.createdAt,
        })),
      );
    }),
  );

  server.registerTool(
    'get_ticket',
    {
      title: 'Get ticket',
      description: 'Get full detail for a single ticket by id.',
      inputSchema: { id: z.string() },
    },
    auditTool(ctx, 'get_ticket', 'ticket', async (args) => {
      if (!requirePermission(ctx, 'tickets:read')) return forbiddenResult('tickets:read');
      const ticket: any = await ticketService.getTicketById(ctx.tenantId, args.id as string);
      return textResult({
        id: ticket._id.toString(),
        number: ticket.number,
        title: ticket.title,
        description: ticket.description,
        type: ticket.type,
        status: ticket.status,
        priority: ticket.priority,
        labels: ticket.labels,
        created_at: ticket.createdAt,
      });
    }),
  );

  server.registerTool(
    'list_alert_rules',
    {
      title: 'List alert rules',
      description: 'List configured alert rules, optionally filtered by status or severity.',
      inputSchema: {
        status: z.string().optional(),
        severity: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    auditTool(ctx, 'list_alert_rules', 'alert_rule', async (args) => {
      if (!requirePermission(ctx, 'alert-rules:read')) return forbiddenResult('alert-rules:read');
      const rules: any = await alertRuleService.listAlertRules(ctx.tenantId.toString(), {
        status: args.status as string | undefined,
        severity: args.severity as string | undefined,
        limit: (args.limit as number | undefined) ?? 20,
      });
      const list = Array.isArray(rules) ? rules : (rules.data ?? []);
      return textResult(
        list.map((r: any) => ({
          id: r._id?.toString?.() ?? r.id,
          name: r.name,
          severity: r.severity,
          status: r.status,
          source_type: r.source_type,
        })),
      );
    }),
  );

  server.registerTool(
    'get_current_oncall',
    {
      title: 'Get current on-call',
      description: 'List the users currently on call across all schedules for this organization.',
      inputSchema: {},
    },
    auditTool(ctx, 'get_current_oncall', 'oncall_schedule', async () => {
      if (!requirePermission(ctx, 'oncall:read')) return forbiddenResult('oncall:read');
      const userIds = await oncallService.getCurrentOnCallUsers(ctx.tenantId);
      const users = await User.find({ _id: { $in: userIds } }).select('_id name email').lean();
      return textResult(users.map((u: any) => ({ id: u._id.toString(), name: u.name, email: u.email })));
    }),
  );

  server.registerTool(
    'list_oncall_schedules',
    {
      title: 'List on-call schedules',
      description: 'List on-call schedules configured for this organization.',
      inputSchema: {
        search: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    auditTool(ctx, 'list_oncall_schedules', 'oncall_schedule', async (args) => {
      if (!requirePermission(ctx, 'oncall:read')) return forbiddenResult('oncall:read');
      const schedules: any = await oncallScheduleService.listSchedules(ctx.tenantId.toString(), {
        search: args.search as string | undefined,
        limit: (args.limit as number | undefined) ?? 20,
      });
      return textResult(
        schedules.map((s: any) => ({ id: s._id.toString(), name: s.name, timezone: s.timezone, enabled: s.enabled })),
      );
    }),
  );

  server.registerTool(
    'get_oncall_schedule',
    {
      title: 'Get on-call schedule',
      description: 'Get a single on-call schedule, including who is currently on call for it.',
      inputSchema: { id: z.string() },
    },
    auditTool(ctx, 'get_oncall_schedule', 'oncall_schedule', async (args) => {
      if (!requirePermission(ctx, 'oncall:read')) return forbiddenResult('oncall:read');
      const schedule: any = await oncallScheduleService.getScheduleById(ctx.tenantId.toString(), args.id as string);
      const current = await oncallScheduleService.getCurrentOnCall(ctx.tenantId.toString(), args.id as string);
      return textResult({
        id: schedule._id.toString(),
        name: schedule.name,
        timezone: schedule.timezone,
        enabled: schedule.enabled,
        current_on_call: current,
      });
    }),
  );

  server.registerTool(
    'list_escalation_policies',
    {
      title: 'List escalation policies',
      description: 'List escalation policies configured for this organization.',
      inputSchema: {
        status: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    auditTool(ctx, 'list_escalation_policies', 'escalation_policy', async (args) => {
      if (!requirePermission(ctx, 'escalation:read')) return forbiddenResult('escalation:read');
      const result = await escalationPolicyService.listEscalationPolicies(
        ctx.tenantId,
        { limit: (args.limit as number | undefined) ?? 20 },
        { status: args.status as string | undefined },
      );
      return textResult(
        result.data.map((p: any) => ({
          id: p._id.toString(),
          name: p.name,
          status: p.status,
          step_count: (p.steps ?? []).length,
        })),
      );
    }),
  );

  server.registerTool(
    'list_service_dependencies',
    {
      title: 'List service dependencies',
      description: 'List dependency edges between services, optionally filtered by status or a specific service.',
      inputSchema: {
        status: z.string().optional(),
        source_service_id: z.string().optional(),
        target_service_id: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    auditTool(ctx, 'list_service_dependencies', 'service_dependency', async (args) => {
      if (!requirePermission(ctx, 'services:read')) return forbiddenResult('services:read');
      const result: any = await serviceDependencyService.list(ctx.tenantId.toString(), {
        status: args.status as string | undefined,
        source_service_id: args.source_service_id as string | undefined,
        target_service_id: args.target_service_id as string | undefined,
        limit: (args.limit as number | undefined) ?? 50,
      });
      const list = Array.isArray(result) ? result : (result.data ?? []);
      return textResult(
        list.map((d: any) => ({
          id: d._id?.toString?.() ?? d.id,
          source_service: d.source_service_id?.name ?? d.source_service_id?.toString?.(),
          target_service: d.target_service_id?.name ?? d.target_service_id?.toString?.(),
          dependency_type: d.dependency_type,
          criticality: d.criticality,
          status: d.status,
        })),
      );
    }),
  );

  server.registerTool(
    'list_postmortems',
    {
      title: 'List postmortems',
      description: 'List postmortems for this organization, optionally filtered by status or severity.',
      inputSchema: {
        status: z.string().optional(),
        severity: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    auditTool(ctx, 'list_postmortems', 'postmortem', async (args) => {
      if (!requirePermission(ctx, 'postmortems:read')) return forbiddenResult('postmortems:read');
      const result = await postmortemService.listPostmortems(
        { tenant_id: ctx.tenantId, status: args.status as string | undefined, severity: args.severity as string | undefined },
        { limit: (args.limit as number | undefined) ?? 20 },
      );
      return textResult(
        result.data.map((p: any) => ({
          id: p._id.toString(),
          title: p.title,
          status: p.status,
          severity: p.severity,
          created_at: p.createdAt,
        })),
      );
    }),
  );

  server.registerTool(
    'get_postmortem',
    {
      title: 'Get postmortem',
      description: 'Get full detail for a single postmortem by id.',
      inputSchema: { id: z.string() },
    },
    auditTool(ctx, 'get_postmortem', 'postmortem', async (args) => {
      if (!requirePermission(ctx, 'postmortems:read')) return forbiddenResult('postmortems:read');
      const postmortem: any = await postmortemService.getPostmortemById(ctx.tenantId, args.id as string);
      return textResult({
        id: postmortem._id.toString(),
        title: postmortem.title,
        status: postmortem.status,
        severity: postmortem.severity,
        summary: postmortem.summary,
        action_items: postmortem.action_items,
        created_at: postmortem.createdAt,
      });
    }),
  );

  server.registerTool(
    'list_runbooks',
    {
      title: 'List runbooks',
      description: 'List runbooks, optionally filtered by service or search text.',
      inputSchema: {
        service_id: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    auditTool(ctx, 'list_runbooks', 'runbook', async (args) => {
      if (!requirePermission(ctx, 'runbooks:read')) return forbiddenResult('runbooks:read');
      const result = await runbookService.listRunbooks(
        {
          tenant_id: ctx.tenantId,
          service_id: args.service_id as string | undefined,
          search: args.search as string | undefined,
        } as any,
        { limit: (args.limit as number | undefined) ?? 20 },
      );
      return textResult(
        result.data.map((r: any) => ({
          id: r._id.toString(),
          title: r.title,
          description: r.description,
          status: r.status,
        })),
      );
    }),
  );

  server.registerTool(
    'list_service_health',
    {
      title: 'List service health',
      description: 'List services and their current operational status.',
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
    },
    auditTool(ctx, 'list_service_health', 'service', async (args) => {
      if (!requirePermission(ctx, 'services:read')) return forbiddenResult('services:read');
      const services = await Service.find({ tenant_id: ctx.tenantId, deleted_at: null })
        .select('name type current_status')
        .limit((args.limit as number | undefined) ?? 50)
        .lean();
      return textResult(
        services.map((s: any) => ({ id: s._id.toString(), name: s.name, type: s.type, status: s.current_status })),
      );
    }),
  );

  server.registerTool(
    'list_status_pages',
    {
      title: 'List status pages',
      description: 'List this organization\'s public status pages.',
      inputSchema: {},
    },
    auditTool(ctx, 'list_status_pages', 'status_page', async () => {
      if (!requirePermission(ctx, 'status-pages:read')) return forbiddenResult('status-pages:read');
      const pages = await statusPageService.listStatusPages(ctx.tenantId);
      return textResult(pages.map((p: any) => ({ id: p._id.toString(), name: p.name, slug: p.slug })));
    }),
  );

  server.registerTool(
    'list_teams',
    {
      title: 'List teams',
      description: 'List teams in this organization and their members.',
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
    },
    auditTool(ctx, 'list_teams', 'team', async (args) => {
      if (!requirePermission(ctx, 'teams:read')) return forbiddenResult('teams:read');
      const result = await teamService.listTeams(ctx.tenantId, { limit: (args.limit as number | undefined) ?? 50 });
      return textResult(
        result.data.map((t: any) => ({
          id: t._id.toString(),
          name: t.name,
          member_count: (t.members ?? []).length,
          team_lead: t.team_lead ? { name: t.team_lead.name, email: t.team_lead.email } : null,
        })),
      );
    }),
  );

  server.registerTool(
    'list_channels',
    {
      title: 'List channels',
      description: 'List incident war-room channels for this organization.',
      inputSchema: {
        type: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    auditTool(ctx, 'list_channels', 'channel', async (args) => {
      if (!requirePermission(ctx, 'channels:read')) return forbiddenResult('channels:read');
      const result = await channelService.listChannels(
        ctx.tenantId,
        { limit: (args.limit as number | undefined) ?? 50 },
        args.type as string | undefined,
      );
      return textResult(
        result.data.map((c: any) => ({ id: c._id.toString(), name: c.name, type: c.type, is_archived: c.is_archived })),
      );
    }),
  );

  server.registerTool(
    'list_slos',
    {
      title: 'List SLOs',
      description: 'List service-level objectives configured for this organization.',
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
    },
    auditTool(ctx, 'list_slos', 'slo_definition', async (args) => {
      if (!requirePermission(ctx, 'monitoring-integrations:read')) return forbiddenResult('monitoring-integrations:read');
      const docs = await SloDefinition.find({ tenant_id: ctx.tenantId })
        .sort({ created_at: -1 })
        .limit((args.limit as number | undefined) ?? 50)
        .lean();
      return textResult(
        docs.map((s: any) => ({
          id: s._id.toString(),
          name: s.name,
          service_id: s.service_id?.toString?.() ?? null,
          objective_pct: s.objective_pct,
          status: s.status,
          current_sli_pct: s.current_sli_pct,
          error_budget_remaining_pct: s.error_budget_remaining_pct,
        })),
      );
    }),
  );

  server.registerTool(
    'query_metrics',
    {
      title: 'Query metrics',
      description:
        "Run a PromQL query against this organization's metrics backend. Provide start/end for a range query over time, or omit them for a single instant query.",
      inputSchema: {
        query: z.string(),
        start: z.string().optional(),
        end: z.string().optional(),
        step: z.string().optional(),
      },
    },
    auditTool(ctx, 'query_metrics', 'metrics', async (args) => {
      if (!requirePermission(ctx, 'metrics:read')) return forbiddenResult('metrics:read');
      const ep = await resolveObservabilityEndpoints(ctx.tenantId.toString());
      if (!ep) {
        return {
          content: [{ type: 'text' as const, text: 'No observability connection configured for this organization.' }],
          isError: true,
        };
      }
      const isRange = Boolean(args.start || args.end);
      const params = new URLSearchParams({ query: args.query as string });
      let path: string;
      if (isRange) {
        const now = Math.floor(Date.now() / 1000);
        params.set('start', (args.start as string | undefined) ?? String(now - 3600));
        params.set('end', (args.end as string | undefined) ?? String(now));
        params.set('step', (args.step as string | undefined) ?? '60s');
        path = 'query_range';
      } else {
        path = 'query';
      }
      const data = await proxyObservabilityFetch(`${ep.metrics_url}/prometheus/api/v1/${path}?${params}`, ep.orgId);
      return textResult(capMetricsResult(data));
    }),
  );

  // ─── Propose tools — never write directly, always via McpProposal ─────────

  server.registerTool(
    'propose_ticket',
    {
      title: 'Propose a new ticket',
      description:
        'Draft a new ticket for a human to review and approve. This does NOT create the ticket — it creates a pending proposal that a stakeholder must explicitly approve in SREonCall before the ticket exists.',
      inputSchema: {
        project_id: z.string(),
        title: z.string(),
        type: z.string().default('task'),
        description: z.string().optional(),
        priority: z.string().optional(),
      },
    },
    auditTool(ctx, 'propose_ticket', 'mcp_proposal', async (args) => {
      if (!requirePermission(ctx, 'tickets:create')) return forbiddenResult('tickets:create');
      const proposal = await mcpProposalService.createProposal({
        tenant_id: ctx.tenantId,
        created_by_api_key_id: ctx.apiKeyId,
        tool_name: 'propose_ticket',
        target_type: 'ticket',
        summary: `Create a ${args.type ?? 'task'} ticket: "${args.title}"${args.priority ? ` (priority: ${args.priority})` : ''}`,
        payload: {
          project_id: args.project_id,
          title: args.title,
          type: args.type ?? 'task',
          description: args.description,
          priority: args.priority,
        },
      });
      return textResult({
        proposal_id: proposal._id.toString(),
        status: 'pending',
        message: 'Proposal created. A stakeholder must approve it in SREonCall (Settings → Integrations) before this ticket is created.',
      });
    }),
  );

  server.registerTool(
    'propose_change',
    {
      title: 'Propose a change request',
      description:
        'Draft a new change request for a human to review and approve. This does NOT create or schedule the change — it creates a pending proposal. The resulting change request still goes through your normal approval chain once a stakeholder approves the proposal itself.',
      inputSchema: {
        title: z.string(),
        type: z.enum(['standard', 'normal', 'emergency']).optional(),
        description: z.string().optional(),
        justification: z.string().optional(),
        rollback_plan: z.string().optional(),
        affected_service_ids: z.array(z.string()).optional(),
      },
    },
    auditTool(ctx, 'propose_change', 'mcp_proposal', async (args) => {
      if (!requirePermission(ctx, 'changes:create')) return forbiddenResult('changes:create');
      const proposal = await mcpProposalService.createProposal({
        tenant_id: ctx.tenantId,
        created_by_api_key_id: ctx.apiKeyId,
        tool_name: 'propose_change',
        target_type: 'change_request',
        summary: `Create a ${args.type ?? 'normal'} change request: "${args.title}"${args.justification ? ` — ${args.justification}` : ''}`,
        payload: {
          title: args.title,
          type: args.type,
          description: args.description,
          justification: args.justification,
          rollback_plan: args.rollback_plan,
          affected_service_ids: args.affected_service_ids,
        },
      });
      return textResult({
        proposal_id: proposal._id.toString(),
        status: 'pending',
        message: 'Proposal created as a draft change request. A stakeholder must approve it in SREonCall (Settings → Integrations); it will then still go through your normal change approval chain.',
      });
    }),
  );

  server.registerTool(
    'propose_runbook',
    {
      title: 'Propose a new runbook',
      description:
        'Draft a new runbook for a human to review and approve. This does NOT create the runbook — it creates a pending proposal that a stakeholder must explicitly approve in SREonCall before the runbook exists.',
      inputSchema: {
        title: z.string(),
        description: z.string().optional(),
        content: z.string().optional(),
        category: z.string().optional(),
        service_ids: z.array(z.string()).optional(),
      },
    },
    auditTool(ctx, 'propose_runbook', 'mcp_proposal', async (args) => {
      if (!requirePermission(ctx, 'runbooks:create')) return forbiddenResult('runbooks:create');
      const proposal = await mcpProposalService.createProposal({
        tenant_id: ctx.tenantId,
        created_by_api_key_id: ctx.apiKeyId,
        tool_name: 'propose_runbook',
        target_type: 'runbook',
        summary: `Create a runbook: "${args.title}"`,
        payload: {
          title: args.title,
          description: args.description,
          content: args.content,
          category: args.category,
          service_ids: args.service_ids,
        },
      });
      return textResult({
        proposal_id: proposal._id.toString(),
        status: 'pending',
        message: 'Proposal created. A stakeholder must approve it in SREonCall (Settings → Integrations) before this runbook is created.',
      });
    }),
  );

  server.registerTool(
    'propose_alert_rule',
    {
      title: 'Propose a new alert rule',
      description:
        'Draft a new alert rule for a human to review and approve. This does NOT create the alert rule — it creates a pending proposal that a stakeholder must explicitly approve in SREonCall before the rule is active.',
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        service_id: z.string().optional(),
        severity: z.string().optional(),
        metric: z.string(),
        operator: z.enum(['gt', 'lt', 'gte', 'lte', 'eq', 'expr', 'absent']),
        threshold: z.number(),
        window_minutes: z.number().optional(),
      },
    },
    auditTool(ctx, 'propose_alert_rule', 'mcp_proposal', async (args) => {
      if (!requirePermission(ctx, 'alert-rules:create')) return forbiddenResult('alert-rules:create');
      const proposal = await mcpProposalService.createProposal({
        tenant_id: ctx.tenantId,
        created_by_api_key_id: ctx.apiKeyId,
        tool_name: 'propose_alert_rule',
        target_type: 'alert_rule',
        summary: `Create an alert rule: "${args.name}" (${args.metric} ${args.operator} ${args.threshold})`,
        payload: {
          name: args.name,
          description: args.description,
          service_id: args.service_id,
          severity: args.severity,
          condition: {
            metric: args.metric,
            operator: args.operator,
            threshold: args.threshold,
            window_minutes: args.window_minutes,
          },
        },
      });
      return textResult({
        proposal_id: proposal._id.toString(),
        status: 'pending',
        message: 'Proposal created. A stakeholder must approve it in SREonCall (Settings → Integrations) before this alert rule is created.',
      });
    }),
  );

  server.registerTool(
    'propose_oncall_override',
    {
      title: 'Propose an on-call override',
      description:
        "Draft a temporary on-call override (e.g. covering someone's shift) for a human to review and approve. This does NOT apply the override — it creates a pending proposal a stakeholder must approve first.",
      inputSchema: {
        schedule_id: z.string(),
        user_id: z.string(),
        start: z.string(),
        end: z.string(),
        reason: z.string().optional(),
      },
    },
    auditTool(ctx, 'propose_oncall_override', 'mcp_proposal', async (args) => {
      if (!requirePermission(ctx, 'oncall:update')) return forbiddenResult('oncall:update');
      const proposal = await mcpProposalService.createProposal({
        tenant_id: ctx.tenantId,
        created_by_api_key_id: ctx.apiKeyId,
        tool_name: 'propose_oncall_override',
        target_type: 'oncall_override',
        summary: `Add an on-call override on schedule ${args.schedule_id} for user ${args.user_id} from ${args.start} to ${args.end}`,
        payload: {
          schedule_id: args.schedule_id,
          user_id: args.user_id,
          start: args.start,
          end: args.end,
          reason: args.reason,
        },
      });
      return textResult({
        proposal_id: proposal._id.toString(),
        status: 'pending',
        message: 'Proposal created. A stakeholder must approve it in SREonCall (Settings → Integrations) before this override takes effect.',
      });
    }),
  );
}
