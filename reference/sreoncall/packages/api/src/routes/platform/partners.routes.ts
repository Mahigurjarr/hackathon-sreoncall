// packages/api/src/routes/platform/partners.routes.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { Partner } from '../../models/partner.model';
import { Deal } from '../../models/deal.model';
import { Types } from 'mongoose';
import { sendPartnerInviteEmail } from '../../services/partner-email.service';
import { logger } from '../../utils/logger';
import { escapeRegex } from '../../utils/escape-regex';

const VALID_STATUSES = ['pending', 'active', 'inactive', 'rejected'];
const VALID_PARTNER_TYPES = ['referral', 'reseller', 'msp'];

const router = Router();

function serializePartner(p: any) {
  return {
    _id: p._id.toString(),
    name: p.name,
    email: p.email,
    company: p.company,
    partnerType: p.partnerType,
    status: p.status,
    commissionRate: p.commissionRate,
    assignedTo: p.assignedTo ?? null,
    leadId: p.leadId ? p.leadId.toString() : null,
    notes: (p.notes || []).map((n: any) => ({
      _id: n._id.toString(),
      body: n.body,
      author: n.author,
      created_at: n.created_at,
    })),
    inviteToken: p.inviteToken ?? null,
    inviteTokenExpiresAt: p.inviteTokenExpiresAt ?? null,
    inviteSentAt: p.inviteSentAt ?? null,
    activatedAt: p.activatedAt ?? null,
    source_ip: p.source_ip ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// GET /platform/partners
router.get('/', async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = 25;
  const skip = (page - 1) * limit;

  const filter: Record<string, any> = {};

  if (req.query.status) {
    if (!VALID_STATUSES.includes(req.query.status as string)) {
      res.status(400).json({ detail: 'Invalid status filter.' }); return;
    }
    filter.status = req.query.status;
  }
  if (req.query.partnerType) {
    if (!VALID_PARTNER_TYPES.includes(req.query.partnerType as string)) {
      res.status(400).json({ detail: 'Invalid partnerType filter.' }); return;
    }
    filter.partnerType = req.query.partnerType;
  }
  if (req.query.assigned_to) {
    const assignedTo = (req.query.assigned_to as string).slice(0, 200);
    filter.assignedTo = assignedTo;
  }
  if (req.query.q) {
    const escaped = escapeRegex(req.query.q as string);
    filter.$or = [
      { name: { $regex: escaped, $options: 'i' } },
      { email: { $regex: escaped, $options: 'i' } },
      { company: { $regex: escaped, $options: 'i' } },
    ];
  }

  const [data, total, totalCount, pendingCount, activeCount, commissionResult, forecastAgg] = await Promise.all([
    Partner.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Partner.countDocuments(filter),
    Partner.countDocuments({}),
    Partner.countDocuments({ status: 'pending' }),
    Partner.countDocuments({ status: 'active' }),
    Deal.aggregate([{ $match: { stage: 'closed_won' } }, { $group: { _id: null, total: { $sum: '$commissionEarned' } } }]),
    Deal.aggregate([
      { $match: { stage: { $ne: 'closed_lost' }, commissionBreakdown: { $exists: true, $ne: null } } },
      { $group: { _id: null, total: { $sum: '$commissionBreakdown.totalThreeYear' } } },
    ]),
  ]);

  const totalCommissionEarned = commissionResult[0]?.total ?? 0;
  const totalCommissionForecast = forecastAgg[0]?.total ?? 0;

  // Get deal summary per partner in the result set
  const partnerIds = data.map((p: any) => p._id);
  const dealSummaries = await Deal.aggregate([
    { $match: { partnerId: { $in: partnerIds }, stage: { $nin: ['closed_won', 'closed_lost'] } } },
    { $group: { _id: '$partnerId', activeDeals: { $sum: 1 }, totalARR: { $sum: '$estimatedARR' } } },
  ]);
  const dealSummaryMap: Record<string, { activeDeals: number; totalARR: number }> = {};
  for (const d of dealSummaries) {
    dealSummaryMap[d._id.toString()] = { activeDeals: d.activeDeals, totalARR: d.totalARR };
  }

  // Add earned commission per partner (closed_won deals)
  const earnedByPartner = await Deal.aggregate([
    { $match: { partnerId: { $in: partnerIds }, stage: 'closed_won' } },
    { $group: { _id: '$partnerId', totalEarned: { $sum: '$commissionEarned' } } },
  ]);
  const earnedMap: Record<string, number> = {};
  for (const d of earnedByPartner) {
    earnedMap[d._id.toString()] = d.totalEarned;
  }

  res.json({
    data: data.map((p: any) => ({
      ...serializePartner(p),
      activeDeals: dealSummaryMap[p._id.toString()]?.activeDeals ?? 0,
      dealsTotalARR: dealSummaryMap[p._id.toString()]?.totalARR ?? 0,
      totalEarned: earnedMap[p._id.toString()] ?? 0,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    summary: { total: totalCount, pending: pendingCount, active: activeCount, totalCommissionEarned, totalCommissionForecast },
  });
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().transform((v) => v.toLowerCase()),
  company: z.string().min(1).max(200),
  partnerType: z.enum(['referral', 'reseller', 'msp']),
  commissionRate: z.number().min(0).max(100).default(0),
  leadId: z
    .string()
    .refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid leadId.' })
    .optional(),
});

// POST /platform/partners
router.post('/', async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ detail: 'Validation failed', errors: parsed.error.flatten().fieldErrors }); return;
  }

  const { name, email, company, partnerType, commissionRate, leadId } = parsed.data;

  const existing = await Partner.findOne({ email }).lean();
  if (existing) {
    res.status(409).json({ detail: 'A partner with this email already exists.' }); return;
  }

  const partner = await Partner.create({
    name,
    email,
    company,
    partnerType,
    commissionRate,
    status: 'pending',
    ...(leadId ? { leadId: new Types.ObjectId(leadId) } : {}),
  });

  res.status(201).json(serializePartner(partner.toObject()));
});

const STAGE_WEIGHTS: Record<string, number> = {
  prospect: 0.1,
  demo: 0.25,
  proposal: 0.5,
  negotiation: 0.75,
  closed_won: 1,
};

// GET /platform/partners/:id
router.get('/:id', async (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ detail: 'Invalid partner ID.' }); return;
  }
  const partner = await Partner.findById(id).lean();
  if (!partner) { res.status(404).json({ detail: 'Partner not found.' }); return; }

  const [activeDeals] = await Deal.aggregate([
    { $match: { partnerId: partner._id, stage: { $nin: ['closed_won', 'closed_lost'] } } },
    { $group: { _id: null, count: { $sum: 1 }, totalARR: { $sum: '$estimatedARR' } } },
  ]);

  // Commission forecast rollup across all non-lost deals
  const openDeals = await Deal.find({
    partnerId: partner._id,
    stage: { $nin: ['closed_lost', 'rejected', 'pending_approval'] },
  }).lean();

  const forecast = { year1: 0, year2: 0, year3: 0, totalThreeYear: 0, weighted: 0 };
  let earned = 0;
  for (const d of openDeals) {
    if (d.stage === 'closed_won') earned += d.commissionEarned ?? 0;
    const bd = d.commissionBreakdown;
    if (!bd) continue;
    const y1 = bd.years.find((y: any) => y.year === 1)?.annualAmount ?? 0;
    const y2 = bd.years.find((y: any) => y.year === 2)?.annualAmount ?? 0;
    const y3 = bd.years.find((y: any) => y.year === 3)?.annualAmount ?? 0;
    forecast.year1 += y1;
    forecast.year2 += y2;
    forecast.year3 += y3;
    forecast.totalThreeYear += bd.totalThreeYear ?? (y1 + y2 + y3);
    const weight = STAGE_WEIGHTS[d.stage] ?? 0;
    forecast.weighted += (bd.totalThreeYear ?? (y1 + y2 + y3)) * weight;
  }

  res.json({
    ...serializePartner(partner),
    activeDeals: activeDeals?.count ?? 0,
    totalARR: activeDeals?.totalARR ?? 0,
    commissionEarned: earned,
    commissionForecast: {
      year1: Math.round(forecast.year1),
      year2: Math.round(forecast.year2),
      year3: Math.round(forecast.year3),
      totalThreeYear: Math.round(forecast.totalThreeYear),
      weighted: Math.round(forecast.weighted),
    },
  });
});

const patchSchema = z.object({
  status: z.enum(['pending', 'active', 'inactive', 'rejected']).optional(),
  commissionRate: z.number().min(0).max(100).optional(),
  assignedTo: z.string().max(200).nullable().optional(),
}).strict();

// PATCH /platform/partners/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ detail: 'Invalid partner ID.' }); return;
  }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ detail: 'Validation failed', errors: parsed.error.flatten().fieldErrors }); return;
  }

  const update: Record<string, any> = {};
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if (parsed.data.commissionRate !== undefined) update.commissionRate = parsed.data.commissionRate;
  if (parsed.data.assignedTo !== undefined) update.assignedTo = parsed.data.assignedTo;

  const partner = await Partner.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
  if (!partner) { res.status(404).json({ detail: 'Partner not found.' }); return; }
  res.json(serializePartner(partner));
});

const noteSchema = z.object({ body: z.string().min(1).max(4000) });

// POST /platform/partners/:id/notes
router.post('/:id/notes', async (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ detail: 'Invalid partner ID.' }); return;
  }
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ detail: 'Validation failed', errors: parsed.error.flatten().fieldErrors }); return;
  }

  const author = (req as any).user?.email;
  if (!author) { res.status(401).json({ detail: 'Unauthorized.' }); return; }
  const note = { _id: new Types.ObjectId(), body: parsed.data.body, author, created_at: new Date() };

  const partner = await Partner.findByIdAndUpdate(
    id,
    { $push: { notes: note } },
    { new: true }
  ).lean();
  if (!partner) { res.status(404).json({ detail: 'Partner not found.' }); return; }
  res.status(201).json(serializePartner(partner));
});

// DELETE /platform/partners/:id/notes/:noteId
router.delete('/:id/notes/:noteId', async (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  const noteId = req.params['noteId'] as string;
  if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(noteId)) {
    res.status(400).json({ detail: 'Invalid ID.' }); return;
  }
  const partner = await Partner.findByIdAndUpdate(
    id,
    { $pull: { notes: { _id: new Types.ObjectId(noteId) } } },
    { new: true }
  ).lean();
  if (!partner) { res.status(404).json({ detail: 'Partner not found.' }); return; }
  res.json(serializePartner(partner));
});

// POST /platform/partners/:id/invite
router.post('/:id/invite', async (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ detail: 'Invalid partner ID.' }); return;
  }

  const partner = await Partner.findById(id);
  if (!partner) { res.status(404).json({ detail: 'Partner not found.' }); return; }

  partner.inviteToken = randomUUID();
  partner.inviteTokenExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  partner.inviteSentAt = new Date();
  await partner.save();

  sendPartnerInviteEmail({
    name: partner.name,
    email: partner.email,
    company: partner.company,
    inviteToken: partner.inviteToken,
  }).catch((err) => logger.error('Failed to send partner invite email', { err }));

  res.json({ success: true, inviteSentAt: partner.inviteSentAt });
});

export default router;
