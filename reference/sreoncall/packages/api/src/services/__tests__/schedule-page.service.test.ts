import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

// Mock the schedule-page model so create/find/findOne are controllable.
const saveMock = vi.fn(async function (this: any) { return this; });
const createdPages: any[] = [];

vi.mock('../../models/schedule-page.model', () => ({
  SchedulePage: {
    findOne: vi.fn(),
    find: vi.fn(),
    create: vi.fn(async (doc: any) => {
      const p = { ...doc, _id: new Types.ObjectId(), save: saveMock };
      createdPages.push(p);
      return p;
    }),
  },
}));

// Mock the schedule model so service can resolve layer users.
vi.mock('../../models/oncall-schedule.model', () => ({
  OnCallSchedule: {
    findOne: vi.fn(),
    findById: vi.fn(),
  },
}));

import { SchedulePage } from '../../models/schedule-page.model';
import { OnCallSchedule } from '../../models/oncall-schedule.model';
import {
  startSchedulePage,
  escalateNextLayer,
  cancelSchedulePagesForIncident,
} from '../schedule-page.service';

function buildSchedule(opts: {
  enabled?: boolean;
  layers: Array<{ users: string[]; escalation_after_minutes?: number | null; id?: string }>;
  overrides?: Array<{ user_id: string; start: Date; end: Date }>;
}) {
  return {
    _id: new Types.ObjectId(),
    enabled: opts.enabled ?? true,
    layers: opts.layers.map((l, i) => ({
      id: l.id ?? `layer-${i}`,
      users: l.users.map((u) => new Types.ObjectId(u)),
      escalation_after_minutes: l.escalation_after_minutes ?? null,
      restrictions: [],
      // Make the layer always-active in tests by zeroing the time window.
      start_time: '00:00',
      end_time: '23:59',
      timezone: 'UTC',
      rotation_length_seconds: 604800,
    })),
    overrides: (opts.overrides || []).map((o) => ({
      user_id: new Types.ObjectId(o.user_id),
      start: o.start,
      end: o.end,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  saveMock.mockClear();
  createdPages.length = 0;
});

describe('schedule-page.service: startSchedulePage', () => {
  it('creates an active page with deadline when layer 0 has escalation_after_minutes and a next layer exists', async () => {
    const u0 = new Types.ObjectId().toString();
    const u1 = new Types.ObjectId().toString();
    const sched = buildSchedule({
      layers: [
        { users: [u0], escalation_after_minutes: 5 },
        { users: [u1], escalation_after_minutes: null },
      ],
    });
    (OnCallSchedule.findOne as any).mockResolvedValue(sched);
    (SchedulePage.findOne as any).mockResolvedValue(null);

    const incidentId = new Types.ObjectId();
    const tenantId = new Types.ObjectId();
    const now = new Date('2026-05-03T12:00:00Z');
    const result = await startSchedulePage(sched._id, incidentId, tenantId, { tierLevel: 1 }, now);

    expect(result.user_id?.toString()).toBe(u0);
    expect(result.is_override).toBe(false);
    expect(SchedulePage.create).toHaveBeenCalledOnce();
    const page = (SchedulePage.create as any).mock.calls[0][0];
    expect(page.status).toBe('active');
    expect(page.current_layer_index).toBe(0);
    expect(page.layer_deadline.getTime() - now.getTime()).toBe(5 * 60_000);
    expect(page.tier_level).toBe(1);
    expect(page.history).toHaveLength(1);
    expect(page.history[0].reason).toBe('initial');
  });

  it('creates a completed page (no deadline) when there is no next layer', async () => {
    const u0 = new Types.ObjectId().toString();
    const sched = buildSchedule({ layers: [{ users: [u0], escalation_after_minutes: 5 }] });
    (OnCallSchedule.findOne as any).mockResolvedValue(sched);
    (SchedulePage.findOne as any).mockResolvedValue(null);

    const result = await startSchedulePage(sched._id, new Types.ObjectId(), new Types.ObjectId());
    expect(result.user_id?.toString()).toBe(u0);
    const page = (SchedulePage.create as any).mock.calls[0][0];
    expect(page.status).toBe('completed');
    expect(page.layer_deadline).toBe(null);
  });

  it('creates a completed page when the layer has no escalation_after_minutes set', async () => {
    const u0 = new Types.ObjectId().toString();
    const u1 = new Types.ObjectId().toString();
    const sched = buildSchedule({
      layers: [
        { users: [u0], escalation_after_minutes: null },
        { users: [u1], escalation_after_minutes: null },
      ],
    });
    (OnCallSchedule.findOne as any).mockResolvedValue(sched);
    (SchedulePage.findOne as any).mockResolvedValue(null);
    const result = await startSchedulePage(sched._id, new Types.ObjectId(), new Types.ObjectId());
    expect(result.user_id?.toString()).toBe(u0);
    const page = (SchedulePage.create as any).mock.calls[0][0];
    expect(page.status).toBe('completed');
    expect(page.layer_deadline).toBe(null);
  });

  it('returns the override user with no escalation', async () => {
    const overrideUser = new Types.ObjectId().toString();
    const u0 = new Types.ObjectId().toString();
    const now = new Date('2026-05-03T12:00:00Z');
    const sched = buildSchedule({
      layers: [{ users: [u0], escalation_after_minutes: 5 }],
      overrides: [{ user_id: overrideUser, start: new Date(now.getTime() - 60_000), end: new Date(now.getTime() + 60_000) }],
    });
    (OnCallSchedule.findOne as any).mockResolvedValue(sched);
    (SchedulePage.findOne as any).mockResolvedValue(null);

    const result = await startSchedulePage(sched._id, new Types.ObjectId(), new Types.ObjectId(), {}, now);
    expect(result.user_id?.toString()).toBe(overrideUser);
    expect(result.is_override).toBe(true);
    const page = (SchedulePage.create as any).mock.calls[0][0];
    expect(page.status).toBe('completed');
    expect(page.current_layer_index).toBe(-1);
    expect(page.history[0].reason).toBe('override');
  });

  it('returns null user when the schedule has no on-call rotation', async () => {
    const sched = buildSchedule({ layers: [{ users: [] }] });
    (OnCallSchedule.findOne as any).mockResolvedValue(sched);
    (SchedulePage.findOne as any).mockResolvedValue(null);
    const result = await startSchedulePage(sched._id, new Types.ObjectId(), new Types.ObjectId());
    expect(result.user_id).toBe(null);
    expect(SchedulePage.create).not.toHaveBeenCalled();
  });

  it('is idempotent — returns existing active page without creating a new one', async () => {
    const existing = {
      _id: new Types.ObjectId(),
      status: 'active',
      current_layer_index: 0,
      current_user_id: new Types.ObjectId(),
    };
    (SchedulePage.findOne as any).mockResolvedValue(existing);
    const result = await startSchedulePage(new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId());
    expect(result.page).toBe(existing);
    expect(SchedulePage.create).not.toHaveBeenCalled();
  });

  it('skips when the schedule is disabled', async () => {
    const sched = buildSchedule({ enabled: false, layers: [{ users: [new Types.ObjectId().toString()] }] });
    (OnCallSchedule.findOne as any).mockResolvedValue(sched);
    (SchedulePage.findOne as any).mockResolvedValue(null);
    const result = await startSchedulePage(sched._id, new Types.ObjectId(), new Types.ObjectId());
    expect(result.user_id).toBe(null);
    expect(SchedulePage.create).not.toHaveBeenCalled();
  });
});

describe('schedule-page.service: escalateNextLayer', () => {
  it('promotes to layer N+1, sets deadline from that layer\'s escalation_after_minutes', async () => {
    const u0 = new Types.ObjectId();
    const u1 = new Types.ObjectId();
    const u2 = new Types.ObjectId();
    const sched = buildSchedule({
      layers: [
        { users: [u0.toString()], escalation_after_minutes: 5 },
        { users: [u1.toString()], escalation_after_minutes: 10 },
        { users: [u2.toString()], escalation_after_minutes: null },
      ],
    });
    (OnCallSchedule.findById as any).mockResolvedValue(sched);

    const page: any = {
      _id: new Types.ObjectId(),
      schedule_id: sched._id,
      status: 'active',
      current_layer_index: 0,
      current_layer_id: 'layer-0',
      current_user_id: u0,
      layer_started_at: new Date('2026-05-03T12:00:00Z'),
      layer_deadline: new Date('2026-05-03T12:05:00Z'),
      history: [{ layer_index: 0, layer_id: 'layer-0', user_id: u0, started_at: new Date(), ended_at: null, reason: 'initial' }],
      save: saveMock,
    };
    const now = new Date('2026-05-03T12:05:30Z');
    const result = await escalateNextLayer(page, now);

    expect(result.nextLayerIndex).toBe(1);
    expect(result.nextUserId?.toString()).toBe(u1.toString());
    expect(page.current_layer_index).toBe(1);
    expect(page.status).toBe('active');
    expect(page.layer_deadline?.getTime() - now.getTime()).toBe(10 * 60_000);
    // History: closed layer 0 entry + opened layer 1 entry
    expect(page.history).toHaveLength(2);
    expect(page.history[0].ended_at).toBeTruthy();
    expect(page.history[1].layer_index).toBe(1);
    expect(page.history[1].reason).toBe('no_ack_timeout');
  });

  it('marks completed when escalating from the last layer', async () => {
    const u0 = new Types.ObjectId();
    const u1 = new Types.ObjectId();
    const sched = buildSchedule({
      layers: [
        { users: [u0.toString()], escalation_after_minutes: 5 },
        { users: [u1.toString()], escalation_after_minutes: null },
      ],
    });
    (OnCallSchedule.findById as any).mockResolvedValue(sched);

    const page: any = {
      _id: new Types.ObjectId(),
      schedule_id: sched._id,
      status: 'active',
      current_layer_index: 1,  // already on the last layer
      current_user_id: u1,
      history: [],
      save: saveMock,
    };
    const result = await escalateNextLayer(page, new Date());
    expect(result.nextUserId).toBe(null);
    expect(result.nextLayerIndex).toBe(null);
    expect(page.status).toBe('completed');
  });

  it('skips empty layers and lands on the next non-empty one', async () => {
    const u0 = new Types.ObjectId();
    const u2 = new Types.ObjectId();
    const sched = buildSchedule({
      layers: [
        { users: [u0.toString()], escalation_after_minutes: 5, id: 'l0' },
        { users: [], id: 'l1' },                        // nobody on this layer
        { users: [u2.toString()], escalation_after_minutes: null, id: 'l2' },
      ],
    });
    (OnCallSchedule.findById as any).mockResolvedValue(sched);

    const page: any = {
      _id: new Types.ObjectId(),
      schedule_id: sched._id,
      status: 'active',
      current_layer_index: 0,
      current_user_id: u0,
      history: [{ layer_index: 0, user_id: u0, started_at: new Date(), ended_at: null, reason: 'initial' }],
      save: saveMock,
    };
    const result = await escalateNextLayer(page, new Date());
    expect(result.nextLayerIndex).toBe(2);
    expect(result.nextUserId?.toString()).toBe(u2.toString());
    expect(page.history.some((h: any) => h.reason === 'no_user_for_layer' && h.layer_index === 1)).toBe(true);
  });
});

describe('schedule-page.service: cancelSchedulePagesForIncident', () => {
  it('closes all active pages for an incident', async () => {
    const incidentId = new Types.ObjectId();
    const a = { status: 'active', layer_deadline: new Date(), history: [{ ended_at: null }], save: saveMock };
    const b = { status: 'active', layer_deadline: new Date(), history: [{ ended_at: null }], save: saveMock };
    (SchedulePage.find as any).mockResolvedValue([a, b]);

    const count = await cancelSchedulePagesForIncident(incidentId, 'acknowledged');
    expect(count).toBe(2);
    expect(a.status).toBe('acknowledged');
    expect(b.status).toBe('acknowledged');
    expect(a.layer_deadline).toBe(null);
    expect(b.layer_deadline).toBe(null);
  });

  it('filters by tier when provided', async () => {
    const incidentId = new Types.ObjectId();
    (SchedulePage.find as any).mockResolvedValue([]);
    await cancelSchedulePagesForIncident(incidentId, 'canceled', { tierLevel: 1 });
    const args = (SchedulePage.find as any).mock.calls[0][0];
    expect(args.tier_level).toBe(1);
    expect(args.status).toBe('active');
    expect(args.incident_id).toEqual(incidentId);
  });
});
