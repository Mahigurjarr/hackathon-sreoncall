import { Router, Request, Response } from 'express';
import { Ticket } from '../models/ticket.model';
import { Incident } from '../models/incident.model';
import { AuditLog } from '../models/audit-log.model';
import { Service } from '../models/service.model';
import { OnCallSchedule } from '../models/oncall-schedule.model';
import { ChangeRequest } from '../models/change-request.model';
import { ProviderConsumerLink } from '../models/provider-consumer-link.model';
import { Tenant } from '../models/tenant.model';
import { User } from '../models/user.model';
import { AgentExecution } from '../models/agent-execution.model';
import { AgentInstallation } from '../models/agent-installation.model';
import { AgentApproval } from '../models/agent-approval.model';
import { rbac } from '../middleware/rbac.middleware';

const router = Router();

// GET /api/v1/dashboard/stats
router.get('/stats', rbac('tickets:read'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;

  const [
    openCount,
    inProgressCount,
    resolvedToday,
    totalResolved,
    overdueCount,
    totalWithSla,
  ] = await Promise.all([
    Ticket.countDocuments({
      tenant_id: tenantId,
      status: 'open',
      deleted_at: null,
    }),
    Ticket.countDocuments({
      tenant_id: tenantId,
      status: 'in_progress',
      deleted_at: null,
    }),
    Ticket.countDocuments({
      tenant_id: tenantId,
      resolved_at: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      deleted_at: null,
    }),
    Ticket.countDocuments({
      tenant_id: tenantId,
      resolved_at: { $ne: null },
      deleted_at: null,
    }),
    Ticket.countDocuments({
      tenant_id: tenantId,
      'sla.resolution_deadline': { $lt: new Date() },
      resolved_at: null,
      deleted_at: null,
    }),
    Ticket.countDocuments({
      tenant_id: tenantId,
      'sla.config_id': { $exists: true },
      deleted_at: null,
    }),
  ]);

  // Calculate avg resolution time for tickets resolved in last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const avgResolutionResult = await Ticket.aggregate([
    {
      $match: {
        tenant_id: tenantId,
        resolved_at: { $gte: thirtyDaysAgo },
        deleted_at: null,
      },
    },
    {
      $project: {
        resolution_ms: { $subtract: ['$resolved_at', '$createdAt'] },
      },
    },
    {
      $group: {
        _id: null,
        avg_ms: { $avg: '$resolution_ms' },
      },
    },
  ]);

  const avgResolutionMs = avgResolutionResult[0]?.avg_ms || 0;
  const avgResolutionMinutes = Math.round(avgResolutionMs / 60000);

  // SLA compliance: tickets with SLA that were resolved before deadline
  const slaBreachedCount = await Ticket.countDocuments({
    tenant_id: tenantId,
    'sla.config_id': { $exists: true },
    $expr: {
      $and: [
        { $ne: ['$resolved_at', null] },
        { $gt: ['$resolved_at', '$sla.resolution_deadline'] },
      ],
    },
    deleted_at: null,
  });

  const slaCompliance =
    totalWithSla > 0
      ? Math.round(((totalWithSla - slaBreachedCount) / totalWithSla) * 1000) / 10
      : 100;

  // Active incidents from the incidents collection
  const activeIncidents = await Incident.countDocuments({
    tenant_id: tenantId,
    status: { $nin: ['resolved', 'closed'] },
  });

  res.json({
    active_incidents: activeIncidents,
    open_tickets: openCount,
    in_progress_tickets: inProgressCount,
    resolved_today: resolvedToday,
    total_resolved: totalResolved,
    avg_resolution_minutes: avgResolutionMinutes,
    sla_compliance: slaCompliance,
    overdue_count: overdueCount,
  });
});

// GET /api/v1/dashboard/recent-tickets
router.get('/recent-tickets', rbac('tickets:read'), async (req: Request, res: Response) => {
  const tickets = await Ticket.find({
    tenant_id: req.tenantId,
    deleted_at: null,
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('assignee_id', 'name email avatar_url')
    .populate('reporter_id', 'name email avatar_url');

  const serialized = tickets.map((t) => serializeTicketBrief(t));
  res.json({ data: serialized });
});

// GET /api/v1/dashboard/activity
router.get('/activity', rbac('tickets:read'), async (req: Request, res: Response) => {
  const logs = await AuditLog.find({
    tenant_id: req.tenantId,
    resource_type: { $in: ['ticket', 'ticket_comment', 'user'] },
  })
    .sort({ timestamp: -1 })
    .limit(20);

  const activity = logs.map((log) => ({
    id: log._id.toString(),
    action: formatAuditAction(log.action, log.resource_type),
    actor: log.actor.email || 'System',
    resource_type: log.resource_type,
    resource_id: log.resource_id,
    timestamp: log.timestamp.toISOString(),
  }));

  res.json({ data: activity });
});

// GET /api/v1/dashboard/incidents-summary
router.get('/incidents-summary', rbac('incidents:read'), async (req: Request, res: Response) => {
  const incidents = await Incident.find({
    tenant_id: req.tenantId,
    status: { $nin: ['resolved', 'closed'] },
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('affected_service_ids', 'name current_status')
    .lean();

  const data = incidents.map((inc: any) => ({
    id: inc._id.toString(),
    number: inc.number,
    title: inc.title,
    severity: inc.severity,
    status: inc.status,
    affected_services: (inc.affected_service_ids || []).map((svc: any) => ({
      name: svc.name,
      current_status: svc.current_status,
    })),
    created_at: inc.createdAt?.toISOString?.() ?? inc.createdAt,
    mtta_seconds: inc.metrics?.mtta_seconds ?? null,
    mttr_seconds: inc.metrics?.mttr_seconds ?? null,
  }));

  res.json({ data });
});

// GET /api/v1/dashboard/services-health
router.get('/services-health', rbac('services:read'), async (req: Request, res: Response) => {
  const services = await Service.find({
    tenant_id: req.tenantId,
    enabled: true,
    deleted_at: null,
  })
    .sort({ current_status: 1 })
    .lean();

  const statusOrder = ['major_outage', 'partial_outage', 'degraded', 'maintenance', 'unknown', 'operational'];

  const grouped: Record<string, { count: number; services: any[] }> = {};
  for (const svc of services as any[]) {
    const status = svc.current_status || 'unknown';
    if (!grouped[status]) {
      grouped[status] = { count: 0, services: [] };
    }
    grouped[status].count++;
    grouped[status].services.push({
      id: svc._id.toString(),
      name: svc.name,
      type: svc.type,
      current_status: status,
    });
  }

  // Sort groups by severity
  const sortedGroups = statusOrder
    .filter((s) => grouped[s])
    .map((status) => ({
      status,
      count: grouped[status].count,
      services: grouped[status].services,
    }));

  res.json({
    total: services.length,
    groups: sortedGroups,
  });
});

// GET /api/v1/dashboard/oncall-status
router.get('/oncall-status', rbac('oncall:read'), async (req: Request, res: Response) => {
  const schedules = await OnCallSchedule.find({
    tenant_id: req.tenantId,
    enabled: true,
  })
    .populate('layers.users', 'name email avatar_url')
    .lean();

  const data = (schedules as any[]).map((schedule) => ({
    id: schedule._id.toString(),
    name: schedule.name,
    timezone: schedule.timezone,
    layers: schedule.layers.map((layer: any) => ({
      id: layer.id,
      name: layer.name,
      rotation_type: layer.rotation_type,
      start_time: layer.start_time,
      end_time: layer.end_time,
      timezone: layer.timezone,
      rotation_length_seconds: layer.rotation_length_seconds,
      users: (layer.users || []).map((u: any) => ({
        id: u._id?.toString() ?? u.toString(),
        name: u.name ?? null,
        email: u.email ?? null,
        avatar_url: u.avatar_url ?? null,
      })),
    })),
    overrides: (schedule.overrides || []).map((o: any) => ({
      id: o.id,
      user_id: o.user_id?.toString(),
      start: o.start,
      end: o.end,
      reason: o.reason,
    })),
  }));

  res.json({ data });
});

// GET /api/v1/dashboard/sla-summary
router.get('/sla-summary', rbac('tickets:read'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;

  const results = await Ticket.aggregate([
    {
      $match: {
        tenant_id: tenantId,
        'sla.config_id': { $exists: true, $ne: null },
        deleted_at: null,
      },
    },
    {
      $addFields: {
        is_breached: {
          $cond: {
            if: {
              $and: [
                { $ne: ['$resolved_at', null] },
                { $gt: ['$resolved_at', '$sla.resolution_deadline'] },
              ],
            },
            then: true,
            else: {
              $cond: {
                if: {
                  $and: [
                    { $eq: ['$resolved_at', null] },
                    { $lt: ['$sla.resolution_deadline', new Date()] },
                  ],
                },
                then: true,
                else: false,
              },
            },
          },
        },
        response_ms: {
          $cond: {
            if: { $ne: ['$first_response_at', null] },
            then: { $subtract: ['$first_response_at', '$createdAt'] },
            else: null,
          },
        },
        resolution_ms: {
          $cond: {
            if: { $ne: ['$resolved_at', null] },
            then: { $subtract: ['$resolved_at', '$createdAt'] },
            else: null,
          },
        },
      },
    },
    {
      $group: {
        _id: null,
        total_with_sla: { $sum: 1 },
        breached_count: { $sum: { $cond: ['$is_breached', 1, 0] } },
        avg_response_ms: { $avg: '$response_ms' },
        avg_resolution_ms: { $avg: '$resolution_ms' },
      },
    },
  ]);

  const stats = results[0] || {
    total_with_sla: 0,
    breached_count: 0,
    avg_response_ms: null,
    avg_resolution_ms: null,
  };

  const compliance_percentage =
    stats.total_with_sla > 0
      ? Math.round(((stats.total_with_sla - stats.breached_count) / stats.total_with_sla) * 1000) / 10
      : 100;

  res.json({
    total_with_sla: stats.total_with_sla,
    breached_count: stats.breached_count,
    compliance_percentage,
    avg_response_minutes: stats.avg_response_ms != null ? Math.round(stats.avg_response_ms / 60000) : null,
    avg_resolution_minutes: stats.avg_resolution_ms != null ? Math.round(stats.avg_resolution_ms / 60000) : null,
  });
});

// GET /api/v1/dashboard/changes-summary
router.get('/changes-summary', rbac('changes:read'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [statusCounts, recentChanges] = await Promise.all([
    ChangeRequest.aggregate([
      {
        $match: {
          tenant_id: tenantId,
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]),
    ChangeRequest.find({ tenant_id: tenantId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ]);

  const counts: Record<string, number> = {};
  for (const entry of statusCounts) {
    counts[entry._id] = entry.count;
  }

  const recent = (recentChanges as any[]).map((cr) => ({
    id: cr._id.toString(),
    number: cr.number,
    title: cr.title,
    type: cr.type,
    risk_score: cr.risk?.score ?? null,
    status: cr.status,
    created_at: cr.createdAt?.toISOString?.() ?? cr.createdAt,
  }));

  res.json({
    counts,
    recent,
  });
});

// GET /api/v1/dashboard/provider-overview
router.get('/provider-overview', rbac('tickets:read'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;

  const links = await ProviderConsumerLink.find({
    provider_tenant_id: tenantId,
    status: 'active',
  }).lean();

  const consumerIds = links.map((l: any) => l.consumer_tenant_id);

  if (consumerIds.length === 0) {
    res.json({ data: [] });
    return;
  }

  // Fetch consumer tenant names
  const consumers = await Tenant.find({ _id: { $in: consumerIds } })
    .select('name')
    .lean();
  const consumerNameMap: Record<string, string> = {};
  for (const c of consumers as any[]) {
    consumerNameMap[c._id.toString()] = c.name;
  }

  // Aggregate incident and ticket counts per consumer
  const [incidentCounts, ticketCounts, slaCounts] = await Promise.all([
    Incident.aggregate([
      {
        $match: {
          tenant_id: { $in: consumerIds },
          status: { $nin: ['resolved', 'closed'] },
        },
      },
      { $group: { _id: '$tenant_id', count: { $sum: 1 } } },
    ]),
    Ticket.aggregate([
      {
        $match: {
          tenant_id: { $in: consumerIds },
          status: { $in: ['open', 'in_progress'] },
          deleted_at: null,
        },
      },
      { $group: { _id: '$tenant_id', count: { $sum: 1 } } },
    ]),
    Ticket.aggregate([
      {
        $match: {
          tenant_id: { $in: consumerIds },
          'sla.config_id': { $exists: true, $ne: null },
          deleted_at: null,
        },
      },
      {
        $group: {
          _id: '$tenant_id',
          total: { $sum: 1 },
          breached: {
            $sum: {
              $cond: {
                if: {
                  $and: [
                    { $ne: ['$resolved_at', null] },
                    { $gt: ['$resolved_at', '$sla.resolution_deadline'] },
                  ],
                },
                then: 1,
                else: 0,
              },
            },
          },
        },
      },
    ]),
  ]);

  const incidentMap: Record<string, number> = {};
  for (const r of incidentCounts) incidentMap[r._id.toString()] = r.count;

  const ticketMap: Record<string, number> = {};
  for (const r of ticketCounts) ticketMap[r._id.toString()] = r.count;

  const slaMap: Record<string, { total: number; breached: number }> = {};
  for (const r of slaCounts) slaMap[r._id.toString()] = { total: r.total, breached: r.breached };

  const data = consumerIds.map((cid: any) => {
    const id = cid.toString();
    const sla = slaMap[id];
    const compliance = sla && sla.total > 0
      ? Math.round(((sla.total - sla.breached) / sla.total) * 1000) / 10
      : 100;
    return {
      consumer_id: id,
      consumer_name: consumerNameMap[id] || 'Unknown',
      active_incidents: incidentMap[id] || 0,
      open_tickets: ticketMap[id] || 0,
      sla_compliance: compliance,
    };
  });

  res.json({ data });
});

// GET /api/v1/dashboard/agent-summary
router.get('/agent-summary', rbac('agents:read'), async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    installedCount,
    executionStats,
    pendingApprovals,
  ] = await Promise.all([
    AgentInstallation.countDocuments({
      tenant_id: tenantId,
      enabled: true,
    }),
    AgentExecution.aggregate([
      {
        $match: {
          tenant_id: tenantId,
          started_at: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          successful: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        },
      },
    ]),
    AgentApproval.countDocuments({
      tenant_id: tenantId,
      status: 'pending',
    }),
  ]);

  const stats = executionStats[0] || { total: 0, successful: 0, failed: 0 };

  res.json({
    installed_agents: installedCount,
    executions_last_30d: {
      total: stats.total,
      successful: stats.successful,
      failed: stats.failed,
    },
    pending_approvals: pendingApprovals,
  });
});

// GET /api/v1/dashboard/platform-overview
router.get('/platform-overview', rbac('tenants:read'), async (req: Request, res: Response) => {
  const [tenantsByType, tenantsByPlan, totalUsers] = await Promise.all([
    Tenant.aggregate([
      { $match: { status: { $ne: 'deleted' } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
    Tenant.aggregate([
      { $match: { status: { $ne: 'deleted' } } },
      { $group: { _id: '$plan', count: { $sum: 1 } } },
    ]),
    User.countDocuments({ status: 'active' }),
  ]);

  const byType: Record<string, number> = {};
  for (const r of tenantsByType) byType[r._id] = r.count;

  const byPlan: Record<string, number> = {};
  for (const r of tenantsByPlan) byPlan[r._id] = r.count;

  const totalTenants = Object.values(byType).reduce((a, b) => a + b, 0);

  res.json({
    total_tenants: totalTenants,
    tenants_by_type: byType,
    tenants_by_plan: byPlan,
    total_users: totalUsers,
  });
});

function serializeTicketBrief(ticket: any) {
  return {
    id: ticket._id.toString(),
    number: ticket.number,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    type: ticket.type,
    assignee: ticket.assignee_id
      ? {
          id: ticket.assignee_id._id?.toString() || ticket.assignee_id.toString(),
          name: ticket.assignee_id.name || null,
          email: ticket.assignee_id.email || null,
          avatar_url: ticket.assignee_id.avatar_url || null,
        }
      : null,
    created_at: ticket.createdAt?.toISOString(),
    updated_at: ticket.updatedAt?.toISOString(),
  };
}

function formatAuditAction(action: string, resourceType: string): string {
  const actionMap: Record<string, string> = {
    'ticket.create': 'created a ticket',
    'ticket.update': 'updated a ticket',
    'ticket.delete': 'deleted a ticket',
    'comment.create': 'added a comment',
    'user.invite': 'invited a team member',
    'user.update': 'updated a user',
    'user.delete': 'removed a user',
    'tenant.update': 'updated organization settings',
  };

  return actionMap[action] || action.replace(/\./g, ' ');
}

export default router;
