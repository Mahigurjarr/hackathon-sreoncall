import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as dsarService from '../services/dsar.service';
import { getJetStream } from '../config/nats';
import { DsarType } from '../models/dsar-request.model';

const router = Router();

const createDsarSchema = z.object({
  type: z.enum(['access', 'erasure', 'rectification', 'portability']),
  notes: z.string().max(1000).optional(),
});

// POST /api/v1/dsar — create DSAR request (user self-service)
router.post('/', async (req: Request, res: Response) => {
  const body = createDsarSchema.parse(req.body);

  const request = await dsarService.createDsarRequest(
    req.tenantId,
    req.userId,
    body.type as DsarType,
    body.notes
  );

  // Publish to NATS for async processing
  try {
    const js = getJetStream();
    await js.publish('DSAR.request', new TextEncoder().encode(JSON.stringify({
      request_id: request._id.toString(),
      type: request.type,
      user_id: req.userId.toString(),
      tenant_id: req.tenantId.toString(),
    })));
  } catch {
    // Worker will pick up from DB if NATS publish fails
  }

  res.status(201).json({
    id: request._id,
    type: request.type,
    status: request.status,
    requested_at: request.requested_at.toISOString(),
  });
});

// GET /api/v1/dsar — list user's DSAR requests
router.get('/', async (req: Request, res: Response) => {
  const requests = await dsarService.getDsarRequests(req.tenantId, req.userId);
  res.json({
    requests: requests.map((r) => ({
      id: r._id,
      type: r.type,
      status: r.status,
      requested_at: r.requested_at.toISOString(),
      completed_at: r.completed_at?.toISOString() || null,
      download_url: r.download_url || null,
      notes: r.notes || null,
    })),
  });
});

// GET /api/v1/dsar/:id — request status
router.get('/:id', async (req: Request, res: Response) => {
  const request = await dsarService.getDsarRequestById(
    req.params.id as string,
    req.tenantId,
    req.userId
  );

  if (!request) {
    res.status(404).json({ detail: 'DSAR request not found.' });
    return;
  }

  res.json({
    id: request._id,
    type: request.type,
    status: request.status,
    requested_at: request.requested_at.toISOString(),
    completed_at: request.completed_at?.toISOString() || null,
    download_url: request.download_url || null,
    notes: request.notes || null,
  });
});

// GET /api/v1/dsar/:id/download — download export (returns signed URL or data)
router.get('/:id/download', async (req: Request, res: Response) => {
  const request = await dsarService.getDsarRequestById(
    req.params.id as string,
    req.tenantId,
    req.userId
  );

  if (!request) {
    res.status(404).json({ detail: 'DSAR request not found.' });
    return;
  }

  if (request.status !== 'completed' || !request.download_url) {
    res.status(400).json({ detail: 'Export not yet available.' });
    return;
  }

  if (request.download_expires_at && request.download_expires_at < new Date()) {
    res.status(410).json({ detail: 'Download link has expired. Please submit a new request.' });
    return;
  }

  res.json({ download_url: request.download_url });
});

export default router;
