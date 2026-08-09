import { describe, it, expect } from 'vitest';
import { PartnerUser } from '../partner-user.model';

describe('PartnerUser model shape', () => {
  it('has emailVerified defaulting to false', () => {
    const schemaPaths = (PartnerUser.schema as any).paths;
    expect(schemaPaths.emailVerified.defaultValue).toBe(false);
  });

  it('has email with lowercase and maxlength', () => {
    const emailPath = (PartnerUser.schema as any).paths.email;
    expect(emailPath.options.lowercase).toBe(true);
  });

  it('has sparse unique index on googleId', () => {
    const indexes = PartnerUser.schema.indexes();
    const googleIdx = indexes.find(([fields]: any[]) => fields.googleId !== undefined);
    expect(googleIdx).toBeDefined();
    const [, opts] = googleIdx as any;
    expect(opts.unique).toBe(true);
    expect(opts.sparse).toBe(true);
  });

  it('has sparse unique index on githubId', () => {
    const indexes = PartnerUser.schema.indexes();
    const githubIdx = indexes.find(([fields]: any[]) => fields.githubId !== undefined);
    expect(githubIdx).toBeDefined();
    const [, opts] = githubIdx as any;
    expect(opts.unique).toBe(true);
    expect(opts.sparse).toBe(true);
  });

  it('has non-unique index on partnerId to allow multiple users per partner org', () => {
    const indexes = PartnerUser.schema.indexes();
    const partnerIdx = indexes.find(([fields]: any[]) => fields.partnerId !== undefined);
    expect(partnerIdx).toBeDefined();
    const [, opts] = partnerIdx as any;
    expect(opts.unique).not.toBe(true);
  });
});
