// packages/api/src/routes/platform/leads.routes.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { Lead } from '../../models/lead.model';
import { Partner } from '../../models/partner.model';
import { Types } from 'mongoose';
import { escapeRegex } from '../../utils/escape-regex';
import { sendPartnerInviteEmail } from '../../services/partner-email.service';
import { logger } from '../../utils/logger';

const VALID_STATUSES = ['new', 'contacted', 'qualified', 'closed_won', 'closed_lost'];
const VALID_TRACKS = ['hero', 'demo', 'referral', 'reseller', 'msp', 'partner', 'general'];

const router = Router();

function serializeLead(l: any) {
  return {
    _id: l._id.toString(),
    name: l.name,
    email: l.email,
    company: l.company,
    role: l.role ?? null,
    company_size: l.company_size ?? null,
    message: l.message ?? null,
    track: l.track,
    status: l.status,
    assigned_to: l.assigned_to ?? null,
    notes: (l.notes || []).map((n: any) => ({
      _id: n._id.toString(),
      body: n.body,
      author: n.author,
      created_at: n.created_at,
    })),
    follow_up_at: l.follow_up_at ?? null,
    source_ip: l.source_ip ?? null,
    partnerId: l.partnerId ? l.partnerId.toString() : null,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

// GET /platform/leads
router.get('/', async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
  const skip = (page - 1) * limit;

  const filter: Record<string, any> = {};
  if (req.query.status) {
    if (!VALID_STATUSES.includes(req.query.status as string)) {
      res.status(400).json({ detail: 'Invalid status filter.' }); return;
    }
    filter.status = req.query.status;
  }
  if (req.query.track) {
    if (!VALID_TRACKS.includes(req.query.track as string)) {
      res.status(400).json({ detail: 'Invalid track filter.' }); return;
    }
    filter.track = req.query.track;
  }
  if (req.query.assigned_to) {
    const assignedTo = (req.query.assigned_to as string).slice(0, 200);
    filter.assigned_to = assignedTo;
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
      { name: { $regex: escaped, $options: 'i' } },
      { email: { $regex: escaped, $options: 'i' } },
      { company: { $regex: escaped, $options: 'i' } },
    ];
  }

  const [data, total, totalAll, newCount, qualifiedCount, closedWonCount] = await Promise.all([
    Lead.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Lead.countDocuments(filter),
    Lead.countDocuments({}),
    Lead.countDocuments({ status: 'new' }),
    Lead.countDocuments({ status: 'qualified' }),
    Lead.countDocuments({ status: 'closed_won' }),
  ]);

  res.json({
    data: data.map(serializeLead),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    summary: { total: totalAll, new: newCount, qualified: qualifiedCount, closed_won: closedWonCount },
  });
});

const createSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  email: z.string().email().toLowerCase(),
  company: z.string().min(1).max(200).trim(),
  role: z.string().max(200).trim().optional(),
  company_size: z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+']).optional(),
  message: z.string().max(2000).optional(),
  track: z.enum(['hero', 'demo', 'referral', 'reseller', 'msp', 'partner', 'general']).default('general'),
});

// POST /platform/leads — admin manual create (no rate limit)
router.post('/', async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ detail: 'Validation failed', errors: parsed.error.flatten().fieldErrors }); return;
  }
  const lead = await Lead.create(parsed.data);
  res.status(201).json(serializeLead(lead.toObject()));
});

// GET /platform/leads/:id
router.get('/:id', async (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ detail: 'Invalid lead ID.' }); return;
  }
  const lead = await Lead.findById(id).lean();
  if (!lead) { res.status(404).json({ detail: 'Lead not found.' }); return; }
  res.json(serializeLead(lead));
});

const patchSchema = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'closed_won', 'closed_lost']).optional(),
  assigned_to: z.string().max(200).nullable().optional(),
  follow_up_at: z.string().datetime().nullable().optional(),
}).strict();

// PATCH /platform/leads/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ detail: 'Invalid lead ID.' }); return;
  }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ detail: 'Validation failed', errors: parsed.error.flatten().fieldErrors }); return;
  }

  const update: Record<string, any> = {};
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if (parsed.data.assigned_to !== undefined) update.assigned_to = parsed.data.assigned_to;
  if (parsed.data.follow_up_at !== undefined) {
    update.follow_up_at = parsed.data.follow_up_at ? new Date(parsed.data.follow_up_at) : null;
  }

  const lead = await Lead.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
  if (!lead) { res.status(404).json({ detail: 'Lead not found.' }); return; }
  res.json(serializeLead(lead));
});

const noteSchema = z.object({ body: z.string().min(1).max(4000) });

// POST /platform/leads/:id/notes
router.post('/:id/notes', async (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ detail: 'Invalid lead ID.' }); return;
  }
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ detail: 'Validation failed', errors: parsed.error.flatten().fieldErrors }); return;
  }

  const author = (req as any).user?.email;
  if (!author) { res.status(401).json({ detail: 'Unauthorized.' }); return; }
  const note = { _id: new Types.ObjectId(), body: parsed.data.body, author, created_at: new Date() };

  const lead = await Lead.findByIdAndUpdate(
    id,
    { $push: { notes: note } },
    { new: true }
  ).lean();
  if (!lead) { res.status(404).json({ detail: 'Lead not found.' }); return; }
  res.status(201).json(serializeLead(lead));
});

// DELETE /platform/leads/:id/notes/:noteId
router.delete('/:id/notes/:noteId', async (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  const noteId = req.params['noteId'] as string;
  if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(noteId)) {
    res.status(400).json({ detail: 'Invalid ID.' }); return;
  }
  const lead = await Lead.findByIdAndUpdate(
    id,
    { $pull: { notes: { _id: new Types.ObjectId(noteId) } } },
    { new: true }
  ).lean();
  if (!lead) { res.status(404).json({ detail: 'Lead not found.' }); return; }
  res.json(serializeLead(lead));
});

const convertSchema = z.object({
  partnerType: z.enum(['referral', 'reseller', 'msp']),
  commissionRate: z.number().min(0).max(100).default(10),
});

// POST /platform/leads/:id/convert — convert a closed_won lead to a partner and send invite
router.post('/:id/convert', async (req: Request, res: Response) => {
  const id = req.params['id'] as string;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ detail: 'Invalid lead ID.' }); return;
  }

  const lead = await Lead.findById(id);
  if (!lead) { res.status(404).json({ detail: 'Lead not found.' }); return; }
  if (lead.status !== 'closed_won') {
    res.status(422).json({ detail: 'Lead must be Closed Won before converting to a partner.' }); return;
  }
  if (lead.partnerId) {
    res.status(409).json({ detail: 'This lead has already been converted to a partner.' }); return;
  }

  const parsed = convertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ detail: 'Validation failed', errors: parsed.error.flatten().fieldErrors }); return;
  }

  const existing = await Partner.findOne({ email: lead.email }).lean();
  if (existing) {
    res.status(409).json({ detail: 'A partner with this email already exists.' }); return;
  }

  const partner = await Partner.create({
    leadId: lead._id,
    name: lead.name,
    email: lead.email,
    company: lead.company,
    partnerType: parsed.data.partnerType,
    commissionRate: parsed.data.commissionRate,
    status: 'pending',
  });

  partner.inviteToken = randomUUID();
  partner.inviteTokenExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  partner.inviteSentAt = new Date();
  await partner.save();

  sendPartnerInviteEmail({
    name: partner.name,
    email: partner.email,
    company: partner.company,
    inviteToken: partner.inviteToken,
  }).catch((err: unknown) => logger.error('Failed to send partner invite email', { err }));

  lead.partnerId = partner._id;
  await lead.save();

  res.status(201).json({
    partnerId: partner._id.toString(),
    inviteSentAt: partner.inviteSentAt,
  });
});

export default router;
