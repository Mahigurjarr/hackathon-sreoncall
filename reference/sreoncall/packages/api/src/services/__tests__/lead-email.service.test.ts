import { describe, it, expect } from 'vitest';
import { getNotificationRecipient, getAutoReplySubject } from '../lead-email.service';

describe('getNotificationRecipient', () => {
  it('returns partners@ for partner tracks', () => {
    expect(getNotificationRecipient('referral')).toBe('partners@sreoncall.com');
    expect(getNotificationRecipient('reseller')).toBe('partners@sreoncall.com');
    expect(getNotificationRecipient('msp')).toBe('partners@sreoncall.com');
    expect(getNotificationRecipient('partner')).toBe('partners@sreoncall.com');
  });

  it('returns sales@ for non-partner tracks', () => {
    expect(getNotificationRecipient('hero')).toBe('sales@sreoncall.com');
    expect(getNotificationRecipient('demo')).toBe('sales@sreoncall.com');
    expect(getNotificationRecipient('general')).toBe('sales@sreoncall.com');
  });
});

describe('getAutoReplySubject', () => {
  it('returns demo subject for demo track', () => {
    expect(getAutoReplySubject('demo')).toBe("Your demo request — we'll be in touch");
  });

  it('returns partner subject for partner tracks', () => {
    expect(getAutoReplySubject('referral')).toBe("Your partner programme enquiry — next steps");
    expect(getAutoReplySubject('msp')).toBe("Your partner programme enquiry — next steps");
  });

  it('returns default subject for other tracks', () => {
    expect(getAutoReplySubject('hero')).toBe("Thanks for reaching out to SREonCall");
    expect(getAutoReplySubject('general')).toBe("Thanks for reaching out to SREonCall");
  });
});
