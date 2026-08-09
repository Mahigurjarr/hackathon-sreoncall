import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as consentService from '../services/consent.service';
import { ConsentType } from '../models/consent.model';

const router = Router();

const grantConsentSchema = z.object({
  consent_type: z.enum([
    'privacy_policy',
    'terms_of_service',
    'data_processing',
    'marketing',
    'status_page_subscription',
  ]),
  version: z.string().optional(),
});

// GET /api/v1/consent — list user's consents
router.get('/', async (req: Request, res: Response) => {
  const consents = await consentService.getUserConsents(req.tenantId, req.userId);
  res.json({
    consents: consents.map((c) => ({
      id: c._id,
      consent_type: c.consent_type,
      version: c.version,
      granted: c.granted,
      granted_at: c.granted_at?.toISOString(),
      revoked_at: c.revoked_at?.toISOString() || null,
    })),
  });
});

// POST /api/v1/consent — grant consent
router.post('/', async (req: Request, res: Response) => {
  const body = grantConsentSchema.parse(req.body);
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  const consent = await consentService.grantConsent({
    tenant_id: req.tenantId,
    user_id: req.userId,
    consent_type: body.consent_type as ConsentType,
    version: body.version,
    ip_address: ip,
    user_agent: userAgent,
  });

  res.status(201).json({
    id: consent._id,
    consent_type: consent.consent_type,
    version: consent.version,
    granted: consent.granted,
    granted_at: consent.granted_at?.toISOString(),
  });
});

// DELETE /api/v1/consent/:type — revoke consent
router.delete('/:type', async (req: Request, res: Response) => {
  const consentType = req.params.type as ConsentType;
  const validTypes: ConsentType[] = [
    'privacy_policy', 'terms_of_service', 'data_processing', 'marketing', 'status_page_subscription',
  ];

  if (!validTypes.includes(consentType)) {
    res.status(400).json({ detail: 'Invalid consent type.' });
    return;
  }

  const consent = await consentService.revokeConsent(req.tenantId, req.userId, consentType);
  if (!consent) {
    res.status(404).json({ detail: 'Consent record not found.' });
    return;
  }

  res.json({
    id: consent._id,
    consent_type: consent.consent_type,
    granted: consent.granted,
    revoked_at: consent.revoked_at?.toISOString(),
  });
});

export default router;
