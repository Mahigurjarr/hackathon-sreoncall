import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { Onboarding, type OnboardingDocument, type OnboardingStatus } from '../models/onboarding.model';
import { Tenant } from '../models/tenant.model';
import { sendOnboardingInviteEmail } from './email.service';
import {
  parsePaginationParams,
  buildCursorFilter,
  paginateResults,
  type PaginationParams,
  type PaginatedResult,
} from '../utils/pagination';

const TOKEN_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

interface CreateOnboardingInput {
  tenant_name: string;
  tenant_slug: string;
  contact_email: string;
  assignee_email: string;
  created_by: string;
}

export async function checkSlugAvailability(slug: string): Promise<{ available: boolean; reason?: string }> {
  const existingTenant = await Tenant.findOne({ slug });
  if (existingTenant) {
    return { available: false, reason: 'Slug is already in use by an existing tenant.' };
  }

  const existingOnboarding = await Onboarding.findOne({
    tenant_slug: slug,
    status: { $in: ['pending_submission', 'submitted'] },
  });
  if (existingOnboarding) {
    return { available: false, reason: 'Slug is reserved by a pending onboarding.' };
  }

  return { available: true };
}

export async function createOnboarding(data: CreateOnboardingInput): Promise<OnboardingDocument> {
  const { available, reason } = await checkSlugAvailability(data.tenant_slug);
  if (!available) {
    throw new Error(reason);
  }

  const token = crypto.randomUUID();
  const token_expires_at = new Date(Date.now() + TOKEN_TTL_MS);

  const onboarding = await Onboarding.create({
    tenant_name: data.tenant_name,
    tenant_slug: data.tenant_slug,
    contact_email: data.contact_email,
    assignee_email: data.assignee_email,
    token,
    token_expires_at,
    status: 'pending_submission',
    created_by: new Types.ObjectId(data.created_by),
  });

  // Send email (fire-and-forget)
  sendOnboardingInviteEmail({
    to: data.assignee_email,
    tenantName: data.tenant_name,
    token,
  }).catch((err) => console.error('[onboarding] Failed to send invite email:', err));

  return onboarding;
}

export async function getOnboardingByToken(token: string): Promise<OnboardingDocument | null> {
  const onboarding = await Onboarding.findOne({ token });
  if (!onboarding) return null;
  return onboarding;
}

export async function submitOnboardingForm(token: string, formData: Record<string, any>): Promise<OnboardingDocument> {
  const onboarding = await Onboarding.findOne({ token });
  if (!onboarding) {
    throw new Error('Onboarding not found.');
  }

  if (onboarding.status !== 'pending_submission') {
    throw new Error('This onboarding has already been submitted.');
  }

  if (onboarding.token_expires_at && onboarding.token_expires_at < new Date()) {
    throw new Error('This onboarding link has expired.');
  }

  onboarding.form_data = formData;
  onboarding.status = 'submitted';
  onboarding.submitted_at = new Date();
  await onboarding.save();

  return onboarding;
}

export async function listOnboardings(
  pagination: PaginationParams,
  filters: { status?: string; search?: string }
): Promise<PaginatedResult<OnboardingDocument>> {
  const baseFilter: Record<string, any> = {};

  if (filters.status) {
    baseFilter.status = filters.status;
  }

  if (filters.search) {
    const regex = new RegExp(filters.search, 'i');
    baseFilter.$or = [
      { tenant_name: regex },
      { tenant_slug: regex },
      { assignee_email: regex },
    ];
  }

  const { filter, sort } = buildCursorFilter(pagination, baseFilter);
  const total = await Onboarding.countDocuments(baseFilter);
  const results = await Onboarding.find(filter)
    .sort(sort)
    .limit(pagination.limit + 1)
    .lean<OnboardingDocument[]>();

  return paginateResults(results, pagination, total);
}

export async function getOnboardingById(id: string): Promise<OnboardingDocument | null> {
  return Onboarding.findById(id);
}

export async function approveOnboarding(
  id: string,
  reviewerId: string,
  notes?: string
): Promise<OnboardingDocument> {
  const onboarding = await Onboarding.findById(id);
  if (!onboarding) {
    throw new Error('Onboarding not found.');
  }

  if (onboarding.status !== 'submitted') {
    throw new Error('Only submitted onboardings can be approved.');
  }

  onboarding.status = 'approved';
  onboarding.reviewed_by = new Types.ObjectId(reviewerId);
  onboarding.reviewed_at = new Date();
  if (notes) onboarding.review_notes = notes;
  await onboarding.save();

  return onboarding;
}

export async function rejectOnboarding(
  id: string,
  reviewerId: string,
  notes?: string
): Promise<OnboardingDocument> {
  const onboarding = await Onboarding.findById(id);
  if (!onboarding) {
    throw new Error('Onboarding not found.');
  }

  if (onboarding.status !== 'submitted') {
    throw new Error('Only submitted onboardings can be rejected.');
  }

  onboarding.status = 'rejected';
  onboarding.reviewed_by = new Types.ObjectId(reviewerId);
  onboarding.reviewed_at = new Date();
  if (notes) onboarding.review_notes = notes;
  await onboarding.save();

  return onboarding;
}
