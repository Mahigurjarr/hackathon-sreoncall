import { Tenant } from '../../models/tenant.model';
import { User } from '../../models/user.model';
import { Incident } from '../../models/incident.model';
import { Ticket } from '../../models/ticket.model';

export interface SystemStats {
  tenants: {
    total: number;
    active: number;
    suspended: number;
    by_type: { standalone: number; provider: number; consumer: number };
    by_plan: Record<string, number>;
  };
  users: {
    total: number;
    active: number;
  };
  incidents: {
    total: number;
    open: number;
    resolved: number;
  };
  tickets: {
    total: number;
    open: number;
  };
}

export async function getSystemStats(): Promise<SystemStats> {
  const [
    totalTenants,
    activeTenants,
    suspendedTenants,
    tenantsByType,
    tenantsByPlan,
    totalUsers,
    activeUsers,
    totalIncidents,
    openIncidents,
    resolvedIncidents,
    totalTickets,
    openTickets,
  ] = await Promise.all([
    Tenant.countDocuments({}),
    Tenant.countDocuments({ status: 'active' }),
    Tenant.countDocuments({ status: 'suspended' }),
    Tenant.aggregate([
      { $match: { deleted_at: null } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
    Tenant.aggregate([
      { $match: { deleted_at: null } },
      { $group: { _id: '$plan', count: { $sum: 1 } } },
    ]),
    User.countDocuments({}),
    User.countDocuments({ status: 'active' }),
    Incident.countDocuments({}),
    Incident.countDocuments({ status: { $nin: ['resolved', 'closed'] } }),
    Incident.countDocuments({ status: 'resolved' }),
    Ticket.countDocuments({}),
    Ticket.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
  ]);

  const byType = { standalone: 0, provider: 0, consumer: 0 };
  for (const t of tenantsByType) {
    if (t._id in byType) byType[t._id as keyof typeof byType] = t.count;
  }

  const byPlan: Record<string, number> = {};
  for (const p of tenantsByPlan) {
    byPlan[p._id || 'unknown'] = p.count;
  }

  return {
    tenants: {
      total: totalTenants,
      active: activeTenants,
      suspended: suspendedTenants,
      by_type: byType,
      by_plan: byPlan,
    },
    users: { total: totalUsers, active: activeUsers },
    incidents: { total: totalIncidents, open: openIncidents, resolved: resolvedIncidents },
    tickets: { total: totalTickets, open: openTickets },
  };
}
