import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { PARTNER_USER_ROLES } from '../../../models/partner-user.model';

// Mirrors the schema in team.routes.ts
const invitableRoleSchema = z.enum(['admin', 'member']);
const inviteBodySchema = z.object({
  email: z.string().email().toLowerCase().max(255),
  role: invitableRoleSchema,
});
const patchMemberSchema = z.object({
  role: z.enum(PARTNER_USER_ROLES as unknown as [string, ...string[]]),
});

describe('partner team invite validation', () => {
  it('accepts valid admin and member invites', () => {
    expect(inviteBodySchema.safeParse({ email: 'a@b.com', role: 'admin' }).success).toBe(true);
    expect(inviteBodySchema.safeParse({ email: 'a@b.com', role: 'member' }).success).toBe(true);
  });

  it('rejects invites with role=owner (ownership is transferred, not assigned)', () => {
    expect(inviteBodySchema.safeParse({ email: 'a@b.com', role: 'owner' }).success).toBe(false);
  });

  it('rejects malformed emails', () => {
    expect(inviteBodySchema.safeParse({ email: 'not-an-email', role: 'member' }).success).toBe(false);
  });

  it('lowercases emails', () => {
    const parsed = inviteBodySchema.parse({ email: 'MiXeD@ExAmPlE.com', role: 'member' });
    expect(parsed.email).toBe('mixed@example.com');
  });
});

describe('partner team role patch validation', () => {
  it('accepts all three partner roles', () => {
    for (const r of PARTNER_USER_ROLES) {
      expect(patchMemberSchema.safeParse({ role: r }).success).toBe(true);
    }
  });

  it('rejects unknown roles', () => {
    expect(patchMemberSchema.safeParse({ role: 'superuser' }).success).toBe(false);
  });
});

describe('last-owner guard logic', () => {
  // Replicates the condition used in team.routes.ts
  function canDemoteOrRemoveOwner(currentOwnerCount: number): boolean {
    return currentOwnerCount > 1;
  }

  it('blocks demoting/removing when only one owner remains', () => {
    expect(canDemoteOrRemoveOwner(1)).toBe(false);
  });

  it('allows demoting/removing when multiple owners exist', () => {
    expect(canDemoteOrRemoveOwner(2)).toBe(true);
    expect(canDemoteOrRemoveOwner(5)).toBe(true);
  });
});

describe('requirePartnerRole authorization matrix', () => {
  function isAllowed(role: string | undefined, allowed: string[]): boolean {
    return !!role && allowed.includes(role);
  }

  it('owner can manage invites and members', () => {
    expect(isAllowed('owner', ['owner', 'admin'])).toBe(true);
    expect(isAllowed('owner', ['owner'])).toBe(true);
  });

  it('admin can manage invites but not owner-only actions', () => {
    expect(isAllowed('admin', ['owner', 'admin'])).toBe(true);
    expect(isAllowed('admin', ['owner'])).toBe(false);
  });

  it('member cannot manage anything', () => {
    expect(isAllowed('member', ['owner', 'admin'])).toBe(false);
    expect(isAllowed('member', ['owner'])).toBe(false);
  });

  it('missing role is never allowed', () => {
    expect(isAllowed(undefined, ['owner', 'admin'])).toBe(false);
  });
});
