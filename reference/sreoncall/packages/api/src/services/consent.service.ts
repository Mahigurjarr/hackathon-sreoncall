import { Types } from 'mongoose';
import { Consent, ConsentDocument, ConsentType } from '../models/consent.model';

interface GrantConsentInput {
  tenant_id: Types.ObjectId;
  user_id: Types.ObjectId;
  consent_type: ConsentType;
  version?: string;
  ip_address: string;
  user_agent: string;
}

export async function grantConsent(input: GrantConsentInput): Promise<ConsentDocument> {
  const existing = await Consent.findOne({
    tenant_id: input.tenant_id,
    user_id: input.user_id,
    consent_type: input.consent_type,
  });

  if (existing) {
    existing.granted = true;
    existing.granted_at = new Date();
    existing.revoked_at = undefined;
    existing.version = input.version || '1.0';
    existing.ip_address = input.ip_address;
    existing.user_agent = input.user_agent;
    return existing.save();
  }

  return Consent.create({
    tenant_id: input.tenant_id,
    user_id: input.user_id,
    consent_type: input.consent_type,
    version: input.version || '1.0',
    granted: true,
    granted_at: new Date(),
    ip_address: input.ip_address,
    user_agent: input.user_agent,
  });
}

export async function revokeConsent(
  tenantId: Types.ObjectId,
  userId: Types.ObjectId,
  consentType: ConsentType
): Promise<ConsentDocument | null> {
  const consent = await Consent.findOne({
    tenant_id: tenantId,
    user_id: userId,
    consent_type: consentType,
  });

  if (!consent) return null;

  consent.granted = false;
  consent.revoked_at = new Date();
  return consent.save();
}

export async function getUserConsents(
  tenantId: Types.ObjectId,
  userId: Types.ObjectId
): Promise<ConsentDocument[]> {
  return Consent.find({ tenant_id: tenantId, user_id: userId });
}

export async function checkConsent(
  tenantId: Types.ObjectId,
  userId: Types.ObjectId,
  consentType: ConsentType
): Promise<boolean> {
  const consent = await Consent.findOne({
    tenant_id: tenantId,
    user_id: userId,
    consent_type: consentType,
  });

  return consent?.granted === true;
}
