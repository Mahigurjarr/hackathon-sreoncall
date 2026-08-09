// packages/api/src/routes/platform/deals.routes.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Deal } from '../../models/deal.model';
import { Payout } from '../../models/payout.model';
import { Partner } from '../../models/partner.model';
import { Types } from 'mongoose';
import { logger } from '../../utils/logger';
import { escapeRegex } from '../../utils/escape-regex';
import { computeCommissionBreakdown, defaultTrackForPartner } from '../../services/commission.service';

const VALID_STAGES = ['pending_approval', 'prospect', 'demo', 'proposal', 'negotiation', 'closed_won', 'closed_lost', 'rejected'];

const router = Router();

function serializeDeal(d: any) {
  return {
    _id: d._id.toString(),
    partnerId: d.partnerId.toString(),
    referredCompany: d.referredCompany,
    contactName: d.contactName,
    contactEmail: d.contactEmail,
    estimatedARR: d.estimatedARR,
    productTier: d.productTier,
    currentTools: d.currentTools ?? [],
    expectedCloseDate: d.expectedCloseDate,
    stage: d.stage,
    commissionRate: d.commissionRate,
    commissionEarned: d.commissionEarned,
    commissionBreakdown: d.commissionBreakdown ?? null,
    commissionOverride: d.commissionOverride ?? false,
    notes: d.notes ?? '',
    adminNotes: d.adminNotes ?? '',
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

function serializePayout(p: any) {
  return {
    _id: p._id.toString(),
    dealId: p.dealId.toString(),
    partnerId: p.partnerId.toString(),
    amount: p.amount,
    currency: p.currency,
    paidAt: p.paidAt,
    reference: p.reference,
    notes: p.notes ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// GET /platform/deals
router.get('/', async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = 25;
  const skip = (page - 1) * limit;

  const filter: Record<string, any> = {};

  if (req.query.partnerId) {
    const partnerId = req.query.partnerId as string;
    if (!Types.ObjectId.isValid(partnerId)) {
      res.status(400).json({ detail: 'Invalid partnerId filter.' }); return;
    }
    filter.partnerId = new Types.ObjectId(partnerId);
  }
  if (req.query.stage) {
    if (!VALID_STAGES.includes(req.query.stage as string)) {
      res.status(400).json({ detail: 'Invalid stage filter.' }); return;
    }
    filter.stage = req.query.stage;
  }
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) {
      const d = new Date(req.query.from as string);
      if (isNaN(d.getTime())) { res.status(400).json({ detail: 'Invalid `from` date.' }); return; }
      filter.createdAt.$gte = d;
    }
    if (req.query.to) {
      const d = new Date(req.query.to as string);
      if (isNaN(d.getTime())) { res.status(400).json({ detail: 'Invalid `to` date.' }); return; }
      filter.createdAt.$lte = d;
    }
  }
  if (req.query.q) {
    const escaped = escapeRegex(req.query.q as string);
    filter.$or = [
      { referredCompany: { $regex: escaped, $options: 'i' } },
      { contactName: { $regex: escaped, $options: 'i' } },
    ];
  }

  const [data, total, totalCount, pendingApprovalCount, inPipelineCount, closedWonCount, commissionResult] = await Promise.all([
    Deal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Deal.countDocuments(filter),
    Deal.countDocuments({}),
    Deal.countDocuments({ stage: 'pending_approval' }),
    Deal.countDocuments({ stage: { $nin: ['pending_approval', 'closed_won', 'closed_lost', 'rejected'] } }),
    Deal.countDocuments({ stage: 'closed_won' }),
    Deal.aggregate([
      { $match: { stage: 'closed_won' } },
      { $group: { _id: null, total: { $sum: '$commissionEarned' } } },
    ]),
  ]);

  const totalCommissionPayable = commissionResult[0]?.total ?? 0;

  res.json({
    data: data.map(serializeDeal),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    summary: { total: totalCount, pendingApproval: pendingApprovalCount, inPipeline: inPipelineCount, closedWon: closedWonCount, totalCommissionPayable },
  });
});

// GET /platform/deals/:id
router.get('/:id', async (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ detail: 'Invalid deal ID.' }); return;
  }
  const deal = await Deal.findById(id).lean();
  if (!deal) { res.status(404).json({ detail: 'Deal not found.' }); return; }

  const [payouts, potentialDuplicates] = await Promise.all([
    Payout.find({ dealId: deal._id }).sort({ paidAt: -1 }).lean(),
    // Find deals from OTHER partners that match the same company or contact email
    Deal.find({
      _id: { $ne: deal._id },
      $or: [
        { referredCompany: { $regex: `^${escapeRegex(deal.referredCompany)}$`, $options: 'i' } },
        { contactEmail: deal.contactEmail.toLowerCase() },
      ],
    })
      .select('_id partnerId referredCompany contactEmail stage createdAt')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ]);

  res.json({
    ...serializeDeal(deal),
    payouts: payouts.map(serializePayout),
    potentialDuplicates: potentialDuplicates.map((d: any) => ({
      _id: d._id.toString(),
      partnerId: d.partnerId.toString(),
      referredCompany: d.referredCompany,
      contactEmail: d.contactEmail,
      stage: d.stage,
      createdAt: d.createdAt,
    })),
  });
});

const commissionYearPatchSchema = z.object({
  year: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  ratePct: z.number().min(0).max(100),
  annualAmount: z.number().min(0),
});

const commissionBreakdownPatchSchema = z.object({
  track: z.enum(['referral', 'reseller', 'msp']),
  basis: z.enum(['flat', 'tapered', 'custom']),
  years: z.array(commissionYearPatchSchema).min(1).max(3),
  totalThreeYear: z.number().min(0),
  notes: z.string().max(500).optional(),
});

const patchSchema = z.object({
  stage: z.enum(['pending_approval', 'prospect', 'demo', 'proposal', 'negotiation', 'closed_won', 'closed_lost', 'rejected']).optional(),
  adminNotes: z.string().max(4000).optional(),
  estimatedARR: z.number().min(0).optional(),
  expectedCloseDate: z.string().datetime().optional(),
  commissionBreakdown: commissionBreakdownPatchSchema.optional(),
  resetCommission: z.boolean().optional(), // recompute from engagement model, clears override
}).strict();

// PATCH /platform/deals/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ detail: 'Invalid deal ID.' }); return;
  }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ detail: 'Validation failed', errors: parsed.error.flatten().fieldErrors }); return;
  }

  const deal = await Deal.findById(id).lean();
  if (!deal) { res.status(404).json({ detail: 'Deal not found.' }); return; }

  const {
    stage,
    adminNotes,
    estimatedARR,
    expectedCloseDate,
    commissionBreakdown,
    resetCommission,
  } = parsed.data;

  const updateData: Record<string, any> = {};
  if (stage !== undefined) updateData.stage = stage;
  if (adminNotes !== undefined) updateData.adminNotes = adminNotes;
  if (estimatedARR !== undefined) updateData.estimatedARR = estimatedARR;
  if (expectedCloseDate !== undefined) updateData.expectedCloseDate = new Date(expectedCloseDate);

  const nextARR = estimatedARR ?? deal.estimatedARR;

  // Commission handling ------------------------------------------------------
  // Admin can: (a) manually set a full breakdown, (b) reset to engagement-model
  // default, or (c) leave untouched — in which case ARR changes recompute the
  // breakdown only if no override has been set.
  if (commissionBreakdown) {
    updateData.commissionBreakdown = commissionBreakdown;
    updateData.commissionOverride = true;
    updateData.commissionRate = commissionBreakdown.years[0]?.ratePct ?? deal.commissionRate;
  } else if (resetCommission) {
    const partner = await Partner.findById(deal.partnerId).lean();
    if (partner) {
      const track = defaultTrackForPartner(partner.partnerType);
      const recomputed = computeCommissionBreakdown(track, nextARR, deal.productTier);
      updateData.commissionBreakdown = recomputed;
      updateData.commissionOverride = false;
      updateData.commissionRate = recomputed.years[0]?.ratePct ?? deal.commissionRate;
    }
  } else if (estimatedARR !== undefined && !deal.commissionOverride && deal.commissionBreakdown) {
    // ARR edited without override → recompute using stored track
    const recomputed = computeCommissionBreakdown(
      deal.commissionBreakdown.track,
      nextARR,
      deal.productTier
    );
    updateData.commissionBreakdown = recomputed;
    updateData.commissionRate = recomputed.years[0]?.ratePct ?? deal.commissionRate;
  }

  // Determine the Y1 amount used for commissionEarned when closing
  const effectiveBreakdown = updateData.commissionBreakdown ?? deal.commissionBreakdown;
  const y1Amount = effectiveBreakdown?.years?.find((y: any) => y.year === 1)?.annualAmount;

  // Recalculate commissionEarned when stage changes to/from closed_won
  if (stage === 'closed_won') {
    // Prefer Y1 amount from breakdown; fall back to legacy rate*ARR
    updateData.commissionEarned =
      y1Amount ?? (nextARR * (updateData.commissionRate ?? deal.commissionRate)) / 100;
  } else if (deal.stage === 'closed_won' && stage && (stage as string) !== 'closed_won') {
    updateData.commissionEarned = 0;
  }

  const updated = await Deal.findByIdAndUpdate(id, { $set: updateData }, { new: true }).lean();
  if (!updated) { res.status(404).json({ detail: 'Deal not found.' }); return; }
  res.json(serializeDeal(updated));
});

const payoutCreateSchema = z.object({
  amount: z.number().min(0),
  paidAt: z.string(),
  reference: z.string().max(200),
  notes: z.string().max(1000).optional(),
});

// POST /platform/deals/:id/payouts
router.post('/:id/payouts', async (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ detail: 'Invalid deal ID.' }); return;
  }

  const parsed = payoutCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ detail: 'Validation failed', errors: parsed.error.flatten().fieldErrors }); return;
  }

  const deal = await Deal.findById(id).lean();
  if (!deal) { res.status(404).json({ detail: 'Deal not found.' }); return; }

  const paidAtDate = new Date(parsed.data.paidAt);
  if (isNaN(paidAtDate.getTime())) {
    res.status(422).json({ detail: 'Invalid paidAt date.' }); return;
  }

  const payout = await Payout.create({
    dealId: deal._id,
    partnerId: deal.partnerId,
    amount: parsed.data.amount,
    currency: 'USD',
    paidAt: paidAtDate,
    reference: parsed.data.reference,
    notes: parsed.data.notes,
  });

  res.status(201).json(serializePayout(payout.toObject()));
});

// GET /platform/deals/:id/payouts
router.get('/:id/payouts', async (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ detail: 'Invalid deal ID.' }); return;
  }

  const deal = await Deal.findById(id).lean();
  if (!deal) { res.status(404).json({ detail: 'Deal not found.' }); return; }

  const payouts = await Payout.find({ dealId: deal._id }).sort({ paidAt: -1 }).lean();
  res.json(payouts.map(serializePayout));
});

// DELETE /platform/deals/:id/payouts/:payoutId
router.delete('/:id/payouts/:payoutId', async (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  const payoutId = req.params['payoutId'] as string;
  if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(payoutId)) {
    res.status(400).json({ detail: 'Invalid ID.' }); return;
  }

  const deal = await Deal.findById(id).lean();
  if (!deal) { res.status(404).json({ detail: 'Deal not found.' }); return; }

  const payout = await Payout.findOneAndDelete({ _id: new Types.ObjectId(payoutId), dealId: deal._id });
  if (!payout) { res.status(404).json({ detail: 'Payout not found.' }); return; }

  res.json({ success: true });
});

export default router;
