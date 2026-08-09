import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import mongoose, { Types } from 'mongoose';
import { partnerAuthGuard } from '../../middleware/partnerAuth.middleware';
import { Partner } from '../../models/partner.model';
import { PartnerUser } from '../../models/partner-user.model';
import { Deal } from '../../models/deal.model';
import { Payout } from '../../models/payout.model';
import { computeCommissionBreakdown, defaultTrackForPartner } from '../../services/commission.service';
import teamRoutes from './team.routes';

const router = Router();

// Apply partnerAuthGuard to all routes
router.use(partnerAuthGuard);

router.use('/team', teamRoutes);

// Re-check partner status on every request (JWT is long-lived; status may have changed since login)
router.use(async (req: Request, res: Response, next: NextFunction) => {
  const partner = await Partner.findById(req.partnerUser!.partnerId).select('status').lean();
  if (!partner || partner.status !== 'active') {
    res.status(403).json({ detail: 'Partner account is not active.' });
    return;
  }
  next();
});

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const patchOnboardingSchema = z.object({
  legalEntityName: z.string().trim().min(1).max(300).optional(),
  legalStructure: z.enum(['sole_proprietor', 'llp', 'pvt_ltd', 'ltd', 'partnership', 'other']).optional(),
  businessAddress: z.string().trim().min(1).max(500).optional(),
  taxId: z.string().trim().max(100).optional(),
  bankAccountName: z.string().trim().min(1).max(200).optional(),
  bankAccountNumber: z.string().trim().min(1).max(50).optional(),
  bankRoutingCode: z.string().trim().min(1).max(50).optional(),
  agreementAccepted: z.boolean().optional(),
});

const patchMeSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().email().toLowerCase().optional(),
  password: z
    .object({
      current: z.string().min(1),
      new: z.string().min(8).max(128),
    })
    .optional(),
});

const DEAL_STAGES = ['pending_approval', 'prospect', 'demo', 'proposal', 'negotiation', 'closed_won', 'closed_lost', 'rejected'] as const;
const PARTNER_ALLOWED_STAGES = ['prospect', 'demo', 'proposal', 'negotiation'] as const;
const PRODUCT_TIERS = ['startup', 'growth', 'enterprise', 'self_hosted', 'services'] as const;

const postDealSchema = z.object({
  referredCompany: z.string().trim().min(1).max(200),
  contactName: z.string().trim().min(1).max(200),
  contactEmail: z.string().email().toLowerCase(),
  estimatedARR: z.number().min(0),
  productTier: z.enum(PRODUCT_TIERS),
  currentTools: z.array(z.string().max(100)).optional(),
  expectedCloseDate: z.string().transform((s) => new Date(s)),
  notes: z.string().max(4000).optional(),
});

const patchDealSchema = z.object({
  stage: z.enum(DEAL_STAGES).optional(),
  estimatedARR: z.number().min(0).optional(),
  expectedCloseDate: z
    .string()
    .transform((s) => new Date(s))
    .optional(),
  notes: z.string().max(4000).optional(),
});

// ---------------------------------------------------------------------------
// Helper: strip adminNotes from deal object
// ---------------------------------------------------------------------------
function omitAdminNotes<T extends { adminNotes?: unknown }>(deal: T): Omit<T, 'adminNotes'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { adminNotes: _adminNotes, ...rest } = deal;
  return rest;
}

// ---------------------------------------------------------------------------
// GET /api/v1/partner/me
// ---------------------------------------------------------------------------
router.get('/me', async (req: Request, res: Response) => {
  const { partnerUserId } = req.partnerUser!;

  const partnerUser = await PartnerUser.findById(partnerUserId).lean();
  if (!partnerUser) {
    res.status(404).json({ detail: 'Partner user not found.' });
    return;
  }

  const partner = await Partner.findById(partnerUser.partnerId).lean();
  if (!partner) {
    res.status(404).json({ detail: 'Partner not found.' });
    return;
  }

  res.json({
    partnerUser: {
      _id: partnerUser._id,
      name: partnerUser.name,
      email: partnerUser.email,
      emailVerified: partnerUser.emailVerified,
      role: partnerUser.role ?? 'member',
      lastLoginAt: partnerUser.lastLoginAt ?? null,
    },
    partner: {
      _id: partner._id,
      company: partner.company,
      partnerType: partner.partnerType,
      status: partner.status,
      commissionRate: partner.commissionRate,
    },
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/partner/me
// ---------------------------------------------------------------------------
router.patch('/me', async (req: Request, res: Response) => {
  const { partnerUserId } = req.partnerUser!;

  const body = patchMeSchema.parse(req.body);

  const partnerUser = await PartnerUser.findById(partnerUserId);
  if (!partnerUser) {
    res.status(404).json({ detail: 'Partner user not found.' });
    return;
  }

  // Password change
  if (body.password) {
    if (!partnerUser.passwordHash) {
      res.status(400).json({ detail: 'Current password is incorrect.' });
      return;
    }
    const passwordMatch = await bcrypt.compare(body.password.current, partnerUser.passwordHash);
    if (!passwordMatch) {
      res.status(400).json({ detail: 'Current password is incorrect.' });
      return;
    }
    partnerUser.passwordHash = await bcrypt.hash(body.password.new, 12);
  }

  // Email uniqueness check
  if (body.email && body.email !== partnerUser.email) {
    const existing = await PartnerUser.findOne({ email: body.email }).lean();
    if (existing) {
      res.status(409).json({ detail: 'Email is already taken.' });
      return;
    }
    partnerUser.email = body.email;

    // Also update partner.email
    await Partner.updateOne({ _id: partnerUser.partnerId }, { email: body.email });
  }

  if (body.name !== undefined) {
    partnerUser.name = body.name;
  }

  await partnerUser.save();

  const updatedUser = await PartnerUser.findById(partnerUserId).lean();
  const partner = await Partner.findById(partnerUser.partnerId).lean();

  res.json({
    partnerUser: {
      _id: updatedUser!._id,
      name: updatedUser!.name,
      email: updatedUser!.email,
      emailVerified: updatedUser!.emailVerified,
      lastLoginAt: updatedUser!.lastLoginAt ?? null,
    },
    partner: {
      _id: partner!._id,
      company: partner!.company,
      partnerType: partner!.partnerType,
      status: partner!.status,
      commissionRate: partner!.commissionRate,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/partner/onboarding
// ---------------------------------------------------------------------------
router.get('/onboarding', async (req: Request, res: Response) => {
  const partner = await Partner.findById(req.partnerUser!.partnerId).select('onboarding').lean();
  if (!partner) { res.status(404).json({ detail: 'Partner not found.' }); return; }
  const o = (partner as any).onboarding ?? { agreementAccepted: false };
  res.json({
    legalEntityName: o.legalEntityName ?? null,
    legalStructure: o.legalStructure ?? null,
    businessAddress: o.businessAddress ?? null,
    taxId: o.taxId ?? null,
    bankAccountName: o.bankAccountName ?? null,
    bankAccountNumber: o.bankAccountNumber ?? null,
    bankRoutingCode: o.bankRoutingCode ?? null,
    agreementAccepted: o.agreementAccepted ?? false,
    completedAt: o.completedAt ?? null,
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/partner/onboarding
// ---------------------------------------------------------------------------
router.patch('/onboarding', async (req: Request, res: Response) => {
  const body = patchOnboardingSchema.parse(req.body);
  const partner = await Partner.findById(req.partnerUser!.partnerId);
  if (!partner) { res.status(404).json({ detail: 'Partner not found.' }); return; }

  const o: Record<string, any> = (partner as any).onboarding?.toObject
    ? (partner as any).onboarding.toObject()
    : { ...((partner as any).onboarding ?? {}), agreementAccepted: false };

  if (body.legalEntityName !== undefined) o.legalEntityName = body.legalEntityName;
  if (body.legalStructure !== undefined) o.legalStructure = body.legalStructure;
  if (body.businessAddress !== undefined) o.businessAddress = body.businessAddress;
  if (body.taxId !== undefined) o.taxId = body.taxId;
  if (body.bankAccountName !== undefined) o.bankAccountName = body.bankAccountName;
  if (body.bankAccountNumber !== undefined) o.bankAccountNumber = body.bankAccountNumber;
  if (body.bankRoutingCode !== undefined) o.bankRoutingCode = body.bankRoutingCode;
  if (body.agreementAccepted !== undefined) o.agreementAccepted = body.agreementAccepted;

  const isComplete = !!(
    o.legalEntityName &&
    o.legalStructure &&
    o.businessAddress &&
    o.bankAccountName &&
    o.bankAccountNumber &&
    o.bankRoutingCode &&
    o.agreementAccepted
  );
  if (isComplete && !o.completedAt) {
    o.completedAt = new Date();
  }

  (partner as any).onboarding = o;
  await partner.save();

  const saved = (partner as any).onboarding;
  res.json({
    legalEntityName: saved.legalEntityName ?? null,
    legalStructure: saved.legalStructure ?? null,
    businessAddress: saved.businessAddress ?? null,
    taxId: saved.taxId ?? null,
    bankAccountName: saved.bankAccountName ?? null,
    bankAccountNumber: saved.bankAccountNumber ?? null,
    bankRoutingCode: saved.bankRoutingCode ?? null,
    agreementAccepted: saved.agreementAccepted ?? false,
    completedAt: saved.completedAt ?? null,
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/partner/deals
// ---------------------------------------------------------------------------
router.get('/deals', async (req: Request, res: Response) => {
  const { partnerId } = req.partnerUser!;

  const filter: Record<string, unknown> = { partnerId };

  if (req.query.stage) {
    const stage = req.query.stage as string;
    if (!DEAL_STAGES.includes(stage as (typeof DEAL_STAGES)[number])) {
      res.status(400).json({ detail: `Invalid stage. Must be one of: ${DEAL_STAGES.join(', ')}.` });
      return;
    }
    filter.stage = stage;
  }

  const deals = await Deal.find(filter).sort({ createdAt: -1 }).lean();

  res.json({
    data: deals.map(omitAdminNotes),
    pagination: { page: 1, limit: deals.length, total: deals.length, pages: 1 },
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/partner/deals
// ---------------------------------------------------------------------------
router.post('/deals', async (req: Request, res: Response) => {
  const { partnerId } = req.partnerUser!;

  const body = postDealSchema.parse(req.body);

  const partner = await Partner.findById(partnerId).lean();
  if (!partner) {
    res.status(404).json({ detail: 'Partner not found.' });
    return;
  }

  const track = defaultTrackForPartner(partner.partnerType);
  const breakdown = computeCommissionBreakdown(track, body.estimatedARR, body.productTier);

  const deal = await Deal.create({
    partnerId,
    referredCompany: body.referredCompany,
    contactName: body.contactName,
    contactEmail: body.contactEmail,
    estimatedARR: body.estimatedARR,
    productTier: body.productTier,
    currentTools: body.currentTools ?? [],
    expectedCloseDate: body.expectedCloseDate,
    stage: 'pending_approval',
    commissionRate: breakdown.years[0]?.ratePct ?? 0,
    commissionEarned: 0,
    commissionBreakdown: breakdown,
    commissionOverride: false,
    notes: body.notes ?? '',
    adminNotes: '',
  });

  const dealObj = deal.toObject();
  res.status(201).json(omitAdminNotes(dealObj));
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/partner/deals/:id
// ---------------------------------------------------------------------------
router.patch('/deals/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!Types.ObjectId.isValid(id as string)) {
    res.status(400).json({ detail: 'Invalid deal ID.' });
    return;
  }

  const { partnerId } = req.partnerUser!;

  const deal = await Deal.findOne({ _id: id, partnerId });
  if (!deal) {
    res.status(404).json({ detail: 'Deal not found.' });
    return;
  }

  // Block all partner edits on deals that haven't been approved yet (or were rejected)
  if (deal.stage === 'pending_approval' || deal.stage === 'rejected') {
    res.status(403).json({ detail: 'This deal is awaiting admin approval and cannot be modified yet.' });
    return;
  }

  const body = patchDealSchema.parse(req.body);

  if (body.stage !== undefined) {
    if (['closed_won', 'closed_lost', 'pending_approval', 'rejected'].includes(body.stage)) {
      res.status(400).json({ detail: 'Cannot set stage to this value.' });
      return;
    }
    deal.stage = body.stage;
  }

  // Partners cannot update estimatedARR on closed deals (would desync commissionEarned)
  if (body.estimatedARR !== undefined && (deal.stage === 'closed_won' || deal.stage === 'closed_lost')) {
    res.status(400).json({ detail: 'Cannot update estimated ARR on a closed deal.' });
    return;
  }

  if (body.estimatedARR !== undefined) {
    deal.estimatedARR = body.estimatedARR;
    // Recompute breakdown unless an admin has manually overridden it
    if (!deal.commissionOverride && deal.commissionBreakdown) {
      const recomputed = computeCommissionBreakdown(
        deal.commissionBreakdown.track,
        body.estimatedARR,
        deal.productTier
      );
      deal.commissionBreakdown = recomputed;
      deal.commissionRate = recomputed.years[0]?.ratePct ?? deal.commissionRate;
    }
  }

  if (body.expectedCloseDate !== undefined) {
    deal.expectedCloseDate = body.expectedCloseDate;
  }

  if (body.notes !== undefined) {
    deal.notes = body.notes;
  }

  await deal.save();

  const dealObj = deal.toObject();
  res.json(omitAdminNotes(dealObj));
});

// ---------------------------------------------------------------------------
// GET /api/v1/partner/commissions
// ---------------------------------------------------------------------------
router.get('/commissions', async (req: Request, res: Response) => {
  const { partnerId } = req.partnerUser!;

  // Aggregate totalEarned from closed_won deals
  const partnerObjectId = new mongoose.Types.ObjectId(partnerId);

  const earnedAgg = await Deal.aggregate([
    { $match: { partnerId: partnerObjectId, stage: 'closed_won' } },
    { $group: { _id: null, totalEarned: { $sum: '$commissionEarned' } } },
  ]);

  const totalEarned: number = earnedAgg[0]?.totalEarned ?? 0;

  // Aggregate totalPaid from payouts
  const paidAgg = await Payout.aggregate([
    { $match: { partnerId: partnerObjectId } },
    { $group: { _id: null, totalPaid: { $sum: '$amount' } } },
  ]);

  const totalPaid: number = paidAgg[0]?.totalPaid ?? 0;
  const pendingPayout = totalEarned - totalPaid;

  // Recent closed_won deals
  const closedDeals = await Deal.find({ partnerId, stage: 'closed_won' })
    .sort({ updatedAt: -1 })
    .select('referredCompany stage commissionRate commissionEarned estimatedARR expectedCloseDate commissionBreakdown')
    .lean();

  // Forecast: roll up commissionBreakdown.years across all non-lost deals.
  // Weight by stage to give a probability-adjusted pipeline view.
  const STAGE_WEIGHTS: Record<string, number> = {
    prospect: 0.1,
    demo: 0.25,
    proposal: 0.5,
    negotiation: 0.75,
    closed_won: 1,
  };

  const openDeals = await Deal.find({
    partnerId,
    stage: { $nin: ['closed_lost', 'rejected', 'pending_approval'] },
  })
    .select('stage commissionBreakdown')
    .lean();

  const forecast = { year1: 0, year2: 0, year3: 0, totalThreeYear: 0, weighted: 0 };
  for (const d of openDeals) {
    if (!d.commissionBreakdown) continue;
    const weight = STAGE_WEIGHTS[d.stage] ?? 0;
    const y1 = d.commissionBreakdown.years.find((y) => y.year === 1)?.annualAmount ?? 0;
    const y2 = d.commissionBreakdown.years.find((y) => y.year === 2)?.annualAmount ?? 0;
    const y3 = d.commissionBreakdown.years.find((y) => y.year === 3)?.annualAmount ?? 0;
    forecast.year1 += y1;
    forecast.year2 += y2;
    forecast.year3 += y3;
    forecast.totalThreeYear += d.commissionBreakdown.totalThreeYear;
    forecast.weighted += d.commissionBreakdown.totalThreeYear * weight;
  }
  forecast.year1 = Math.round(forecast.year1);
  forecast.year2 = Math.round(forecast.year2);
  forecast.year3 = Math.round(forecast.year3);
  forecast.totalThreeYear = Math.round(forecast.totalThreeYear);
  forecast.weighted = Math.round(forecast.weighted);

  res.json({
    totalEarned,
    totalPaid,
    pendingPayout,
    forecast,
    deals: closedDeals.map((d) => ({
      _id: d._id,
      referredCompany: d.referredCompany,
      stage: d.stage,
      commissionRate: d.commissionRate,
      commissionEarned: d.commissionEarned,
      estimatedARR: d.estimatedARR,
      expectedCloseDate: d.expectedCloseDate,
      commissionBreakdown: d.commissionBreakdown,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/partner/payouts
// ---------------------------------------------------------------------------
router.get('/payouts', async (req: Request, res: Response) => {
  const { partnerId } = req.partnerUser!;

  const payouts = await Payout.find({ partnerId }).sort({ paidAt: -1 }).lean();
  res.json(payouts);
});

export default router;
