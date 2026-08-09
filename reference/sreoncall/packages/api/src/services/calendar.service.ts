import { Types } from 'mongoose';
import { logger } from '../utils/logger';
import { CalendarConnection, CalendarConnectionDocument } from '../models/calendar-connection.model';
import { deleteCalendar, resolveCalendarOAuth } from './recall-calendar.service';

/** Which calendar providers are usable for a tenant (per-tenant BYO or global). */
export async function providersConfigured(tenantId: Types.ObjectId): Promise<{ google: boolean; microsoft: boolean }> {
  const [g, m] = await Promise.all([
    resolveCalendarOAuth(tenantId, 'google'),
    resolveCalendarOAuth(tenantId, 'microsoft'),
  ]);
  return { google: !!g, microsoft: !!m };
}

export async function listConnections(tenantId: Types.ObjectId): Promise<CalendarConnectionDocument[]> {
  return CalendarConnection.find({ tenant_id: tenantId, status: { $ne: 'disconnected' } }).sort({ created_at: -1 });
}

/**
 * Disconnect a calendar: remove it from Recall (best-effort) and delete our
 * connection record so no further events sync/dispatch.
 */
export async function disconnectConnection(tenantId: Types.ObjectId, id: string): Promise<void> {
  const conn = await CalendarConnection.findOne({ _id: id, tenant_id: tenantId });
  if (!conn) return;
  try {
    if (conn.recall_calendar_id) await deleteCalendar(conn.recall_calendar_id);
  } catch (err: any) {
    logger.warn('Recall calendar delete failed during disconnect (continuing)', { error: err.message });
  }
  await CalendarConnection.deleteOne({ _id: conn._id });
}
