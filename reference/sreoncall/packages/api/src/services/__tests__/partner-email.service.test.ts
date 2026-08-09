import { describe, it, expect } from 'vitest';
import { getApplicationNotificationSubject, getInviteSubject } from '../partner-email.service';

describe('getApplicationNotificationSubject', () => {
  it('formats subject with company and partnerType', () => {
    expect(getApplicationNotificationSubject('Acme Corp', 'referral'))
      .toBe('New partner application: Acme Corp (referral)');
  });

  it('strips CRLF from company name in subject', () => {
    expect(getApplicationNotificationSubject('Acme\r\nBcc: evil@test.com', 'referral'))
      .toBe('New partner application: AcmeBcc: evil@test.com (referral)');
  });
});

describe('getInviteSubject', () => {
  it('returns static invite subject', () => {
    expect(getInviteSubject()).toBe("You're invited to the SREonCall Partner Portal");
  });
});
