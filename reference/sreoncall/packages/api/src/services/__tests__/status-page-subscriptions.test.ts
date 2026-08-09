import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

// ─── Reusable IDs ────────────────────────────────────────────────────────────

const TENANT_ID = new Types.ObjectId();
const PAGE_ID = new Types.ObjectId();
const SUB_ID = new Types.ObjectId();
const SLUG = 'test-status-page';
const PAGE_NAME = 'Test Status Page';

// ─── Mock uuid ───────────────────────────────────────────────────────────────

let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: () => `uuid-${++uuidCounter}`,
}));

// ─── Mock email service ──────────────────────────────────────────────────────

const mockSendSubscriptionConfirmEmail = vi.fn().mockResolvedValue(undefined);
const mockSendStatusUpdateEmail = vi.fn().mockResolvedValue(undefined);

vi.mock('../email.service', () => ({
  sendSubscriptionConfirmEmail: (...args: any[]) =>
    mockSendSubscriptionConfirmEmail(...args),
  sendStatusUpdateEmail: (...args: any[]) =>
    mockSendStatusUpdateEmail(...args),
}));

// ─── Mock NATS ───────────────────────────────────────────────────────────────

vi.mock('nats', () => ({
  StringCodec: () => ({
    encode: (s: string) => Buffer.from(s),
    decode: (b: Buffer) => b.toString(),
  }),
}));

vi.mock('../../config/nats', () => ({
  getJetStream: () => ({ publish: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Mock Mongoose models ────────────────────────────────────────────────────

const mockPageFindOne = vi.fn();
const mockSubFindOne = vi.fn();
const mockSubCreate = vi.fn();
const mockSubFind = vi.fn();
const mockSubDeleteOne = vi.fn();
const mockUpdateFind = vi.fn();

vi.mock('../../models/status-page.model', () => ({
  StatusPage: {
    findOne: (...args: any[]) => mockPageFindOne(...args),
  },
}));

vi.mock('../../models/status-page-subscriber.model', () => ({
  StatusPageSubscriber: {
    findOne: (...args: any[]) => mockSubFindOne(...args),
    create: (...args: any[]) => mockSubCreate(...args),
    find: (...args: any[]) => mockSubFind(...args),
    deleteOne: (...args: any[]) => mockSubDeleteOne(...args),
  },
}));

vi.mock('../../models/status-update.model', () => ({
  StatusUpdate: {
    find: (...args: any[]) => mockUpdateFind(...args),
    create: vi.fn(),
  },
}));

vi.mock('../../middleware/errorHandler.middleware', () => ({
  AppError: {
    notFound: (msg: string) => {
      const err: any = new Error(`${msg} not found`);
      err.status = 404;
      return err;
    },
  },
}));

// ─── Import service after mocks ──────────────────────────────────────────────

import {
  publicSubscribe,
  publicSubscribeSms,
  publicSubscribeWebhook,
  confirmSubscription,
  unsubscribe,
  generateRssFeed,
} from '../status-page.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePage(overrides: Record<string, any> = {}) {
  return {
    _id: PAGE_ID,
    tenant_id: TENANT_ID,
    slug: SLUG,
    name: PAGE_NAME,
    description: 'Test page description',
    is_public: true,
    components: [],
    ...overrides,
  };
}

function makeSubscriber(overrides: Record<string, any> = {}) {
  return {
    _id: SUB_ID,
    tenant_id: TENANT_ID,
    status_page_id: PAGE_ID,
    channel: 'email',
    email: 'user@example.com',
    phone: '',
    webhook_url: '',
    confirmed: false,
    confirm_token: 'confirm-token-1',
    unsubscribe_token: 'unsub-token-1',
    consent_given: false,
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
});

describe('Status Page Subscriptions', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // EMAIL SUBSCRIPTION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('publicSubscribe (email)', () => {
    it('should create new email subscriber and send confirmation email', async () => {
      const page = makePage();
      mockPageFindOne.mockResolvedValue(page);
      mockSubFindOne.mockResolvedValue(null);
      mockSubCreate.mockResolvedValue(makeSubscriber({ confirmed: false }));

      await publicSubscribe(SLUG, 'User@Example.com');

      // Should look up the public status page
      expect(mockPageFindOne).toHaveBeenCalledWith({
        slug: SLUG,
        is_public: true,
      });

      // Should check for existing subscriber
      expect(mockSubFindOne).toHaveBeenCalledWith({
        status_page_id: PAGE_ID,
        email: 'user@example.com', // lowercased
      });

      // Should create subscriber record
      expect(mockSubCreate).toHaveBeenCalledOnce();
      const createArg = mockSubCreate.mock.calls[0][0];
      expect(createArg.tenant_id).toBe(TENANT_ID);
      expect(createArg.status_page_id).toBe(PAGE_ID);
      expect(createArg.email).toBe('user@example.com');
      expect(createArg.confirmed).toBe(false);
      expect(createArg.confirm_token).toBeTruthy();
      expect(createArg.unsubscribe_token).toBeTruthy();

      // Should send confirmation email
      expect(mockSendSubscriptionConfirmEmail).toHaveBeenCalledOnce();
      expect(mockSendSubscriptionConfirmEmail).toHaveBeenCalledWith({
        to: 'User@Example.com',
        pageName: PAGE_NAME,
        slug: SLUG,
        confirmToken: createArg.confirm_token,
      });
    });

    it('should not create duplicate if email already confirmed', async () => {
      const page = makePage();
      mockPageFindOne.mockResolvedValue(page);
      mockSubFindOne.mockResolvedValue(
        makeSubscriber({ confirmed: true, email: 'user@example.com' })
      );

      await publicSubscribe(SLUG, 'user@example.com');

      expect(mockSubCreate).not.toHaveBeenCalled();
      expect(mockSendSubscriptionConfirmEmail).not.toHaveBeenCalled();
    });

    it('should resend confirmation email if subscriber exists but unconfirmed', async () => {
      const page = makePage();
      const existingSub = makeSubscriber({
        confirmed: false,
        confirm_token: 'existing-token',
      });
      mockPageFindOne.mockResolvedValue(page);
      mockSubFindOne.mockResolvedValue(existingSub);

      await publicSubscribe(SLUG, 'user@example.com');

      expect(mockSubCreate).not.toHaveBeenCalled();
      expect(mockSendSubscriptionConfirmEmail).toHaveBeenCalledOnce();
      expect(mockSendSubscriptionConfirmEmail).toHaveBeenCalledWith({
        to: 'user@example.com',
        pageName: PAGE_NAME,
        slug: SLUG,
        confirmToken: 'existing-token',
      });
    });

    it('should throw 404 for non-existent slug', async () => {
      mockPageFindOne.mockResolvedValue(null);

      await expect(publicSubscribe('bad-slug', 'user@example.com')).rejects.toThrow(
        /not found/i
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SMS SUBSCRIPTION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('publicSubscribeSms', () => {
    it('should create new SMS subscriber with confirmed=true', async () => {
      const page = makePage();
      mockPageFindOne.mockResolvedValue(page);
      mockSubFindOne.mockResolvedValue(null);
      mockSubCreate.mockResolvedValue(
        makeSubscriber({ channel: 'sms', phone: '+14155551234', confirmed: true })
      );

      await publicSubscribeSms(SLUG, '+14155551234');

      expect(mockSubCreate).toHaveBeenCalledOnce();
      const createArg = mockSubCreate.mock.calls[0][0];
      expect(createArg.channel).toBe('sms');
      expect(createArg.phone).toBe('+14155551234');
      expect(createArg.confirmed).toBe(true);
      expect(createArg.email).toBe(''); // empty email for SMS
    });

    it('should not create duplicate SMS subscriber for same phone', async () => {
      const page = makePage();
      mockPageFindOne.mockResolvedValue(page);
      mockSubFindOne.mockResolvedValue(
        makeSubscriber({ channel: 'sms', phone: '+14155551234', confirmed: true })
      );

      await publicSubscribeSms(SLUG, '+14155551234');

      expect(mockSubCreate).not.toHaveBeenCalled();
    });

    it('should query by channel and phone for dedup (not email)', async () => {
      const page = makePage();
      mockPageFindOne.mockResolvedValue(page);
      mockSubFindOne.mockResolvedValue(null);
      mockSubCreate.mockResolvedValue(
        makeSubscriber({ channel: 'sms', phone: '+14155551234' })
      );

      await publicSubscribeSms(SLUG, '+14155551234');

      // Should look up by channel+phone, not by email
      expect(mockSubFindOne).toHaveBeenCalledWith({
        status_page_id: PAGE_ID,
        channel: 'sms',
        phone: '+14155551234',
      });
    });

    it('should throw 404 for non-existent slug', async () => {
      mockPageFindOne.mockResolvedValue(null);

      await expect(publicSubscribeSms('bad-slug', '+14155551234')).rejects.toThrow(
        /not found/i
      );
    });

    it('should not send confirmation email for SMS subscribers', async () => {
      const page = makePage();
      mockPageFindOne.mockResolvedValue(page);
      mockSubFindOne.mockResolvedValue(null);
      mockSubCreate.mockResolvedValue(
        makeSubscriber({ channel: 'sms', phone: '+14155551234' })
      );

      await publicSubscribeSms(SLUG, '+14155551234');

      expect(mockSendSubscriptionConfirmEmail).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBHOOK SUBSCRIPTION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('publicSubscribeWebhook', () => {
    it('should create new webhook subscriber with confirmed=true', async () => {
      const page = makePage();
      mockPageFindOne.mockResolvedValue(page);
      mockSubFindOne.mockResolvedValue(null);
      mockSubCreate.mockResolvedValue(
        makeSubscriber({
          channel: 'webhook',
          webhook_url: 'https://hooks.example.com/status',
          confirmed: true,
        })
      );

      await publicSubscribeWebhook(SLUG, 'https://hooks.example.com/status');

      expect(mockSubCreate).toHaveBeenCalledOnce();
      const createArg = mockSubCreate.mock.calls[0][0];
      expect(createArg.channel).toBe('webhook');
      expect(createArg.webhook_url).toBe('https://hooks.example.com/status');
      expect(createArg.confirmed).toBe(true);
      expect(createArg.email).toBe('');
    });

    it('should not create duplicate webhook for same URL', async () => {
      const page = makePage();
      mockPageFindOne.mockResolvedValue(page);
      mockSubFindOne.mockResolvedValue(
        makeSubscriber({
          channel: 'webhook',
          webhook_url: 'https://hooks.example.com/status',
        })
      );

      await publicSubscribeWebhook(SLUG, 'https://hooks.example.com/status');

      expect(mockSubCreate).not.toHaveBeenCalled();
    });

    it('should query by channel and webhook_url for dedup', async () => {
      const page = makePage();
      mockPageFindOne.mockResolvedValue(page);
      mockSubFindOne.mockResolvedValue(null);
      mockSubCreate.mockResolvedValue(
        makeSubscriber({ channel: 'webhook' })
      );

      await publicSubscribeWebhook(SLUG, 'https://hooks.example.com/status');

      expect(mockSubFindOne).toHaveBeenCalledWith({
        status_page_id: PAGE_ID,
        channel: 'webhook',
        webhook_url: 'https://hooks.example.com/status',
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIRM SUBSCRIPTION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('confirmSubscription', () => {
    it('should confirm an unconfirmed subscriber', async () => {
      const page = makePage();
      const sub = makeSubscriber({ confirmed: false });
      mockPageFindOne.mockResolvedValue(page);
      mockSubFindOne.mockResolvedValue(sub);

      const result = await confirmSubscription(SLUG, 'confirm-token-1');

      expect(result).toBe(true);
      expect(sub.confirmed).toBe(true);
      expect(sub.save).toHaveBeenCalledOnce();
    });

    it('should return true without re-saving if already confirmed', async () => {
      const page = makePage();
      const sub = makeSubscriber({ confirmed: true });
      mockPageFindOne.mockResolvedValue(page);
      mockSubFindOne.mockResolvedValue(sub);

      const result = await confirmSubscription(SLUG, 'confirm-token-1');

      expect(result).toBe(true);
      expect(sub.save).not.toHaveBeenCalled();
    });

    it('should return false for invalid token', async () => {
      const page = makePage();
      mockPageFindOne.mockResolvedValue(page);
      mockSubFindOne.mockResolvedValue(null);

      const result = await confirmSubscription(SLUG, 'bad-token');

      expect(result).toBe(false);
    });

    it('should query by status_page_id and confirm_token', async () => {
      const page = makePage();
      mockPageFindOne.mockResolvedValue(page);
      mockSubFindOne.mockResolvedValue(null);

      await confirmSubscription(SLUG, 'some-token');

      expect(mockSubFindOne).toHaveBeenCalledWith({
        status_page_id: PAGE_ID,
        confirm_token: 'some-token',
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // UNSUBSCRIBE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('unsubscribe', () => {
    it('should delete subscriber by unsubscribe_token', async () => {
      const page = makePage();
      mockPageFindOne.mockResolvedValue(page);
      mockSubDeleteOne.mockResolvedValue({ deletedCount: 1 });

      const result = await unsubscribe(SLUG, 'unsub-token-1');

      expect(result).toBe(true);
      expect(mockSubDeleteOne).toHaveBeenCalledWith({
        status_page_id: PAGE_ID,
        unsubscribe_token: 'unsub-token-1',
      });
    });

    it('should return false for invalid unsubscribe token', async () => {
      const page = makePage();
      mockPageFindOne.mockResolvedValue(page);
      mockSubDeleteOne.mockResolvedValue({ deletedCount: 0 });

      const result = await unsubscribe(SLUG, 'bad-token');

      expect(result).toBe(false);
    });

    it('should throw 404 for non-existent slug', async () => {
      mockPageFindOne.mockResolvedValue(null);

      await expect(unsubscribe('bad-slug', 'some-token')).rejects.toThrow(/not found/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RSS FEED
  // ═══════════════════════════════════════════════════════════════════════════

  describe('generateRssFeed', () => {
    const mockReq = {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'status.example.com',
        host: 'status.example.com',
      },
    };

    it('should generate valid RSS 2.0 XML', async () => {
      const page = makePage();
      const updates = [
        {
          _id: new Types.ObjectId(),
          title: 'API Outage Resolved',
          body: 'All systems are back to normal.',
          status: 'resolved',
          created_at: new Date('2026-03-18T10:00:00Z'),
        },
        {
          _id: new Types.ObjectId(),
          title: 'Investigating API Issues',
          body: 'We are investigating high latency.',
          status: 'investigating',
          created_at: new Date('2026-03-18T09:00:00Z'),
        },
      ];

      mockPageFindOne.mockResolvedValue(page);
      mockUpdateFind.mockReturnValue({
        sort: () => ({
          limit: () => ({
            lean: () => Promise.resolve(updates),
          }),
        }),
      });

      const feed = await generateRssFeed(SLUG, mockReq);

      // Should be valid XML with RSS 2.0 structure
      expect(feed).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(feed).toContain('<rss version="2.0"');
      expect(feed).toContain('xmlns:atom="http://www.w3.org/2005/Atom"');

      // Should contain channel metadata
      expect(feed).toContain(`<title>${PAGE_NAME} - Status Updates</title>`);
      expect(feed).toContain(`<link>https://status.example.com/status/${SLUG}</link>`);

      // Should contain atom self-link
      expect(feed).toContain(
        `<atom:link href="https://status.example.com/api/v1/public/status-pages/${SLUG}/rss"`
      );

      // Should contain update items
      expect(feed).toContain('<![CDATA[API Outage Resolved]]>');
      expect(feed).toContain('<![CDATA[All systems are back to normal.]]>');
      expect(feed).toContain('<![CDATA[Investigating API Issues]]>');

      // Should have pubDate for each item
      expect(feed).toContain('<pubDate>');

      // Should have GUIDs
      expect(feed).toContain('<guid>');
    });

    it('should return empty feed when no updates exist', async () => {
      const page = makePage();
      mockPageFindOne.mockResolvedValue(page);
      mockUpdateFind.mockReturnValue({
        sort: () => ({
          limit: () => ({
            lean: () => Promise.resolve([]),
          }),
        }),
      });

      const feed = await generateRssFeed(SLUG, mockReq);

      expect(feed).toContain('<rss version="2.0"');
      expect(feed).toContain(`<title>${PAGE_NAME} - Status Updates</title>`);
      expect(feed).not.toContain('<item>');
    });

    it('should use x-forwarded-host for constructing URLs', async () => {
      const page = makePage();
      mockPageFindOne.mockResolvedValue(page);
      mockUpdateFind.mockReturnValue({
        sort: () => ({
          limit: () => ({
            lean: () => Promise.resolve([]),
          }),
        }),
      });

      const req = {
        headers: {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'custom-domain.com',
          host: 'internal.host',
        },
      };

      const feed = await generateRssFeed(SLUG, req);

      expect(feed).toContain('https://custom-domain.com/status/');
      expect(feed).not.toContain('internal.host');
    });

    it('should fallback to host header if x-forwarded-host missing', async () => {
      const page = makePage();
      mockPageFindOne.mockResolvedValue(page);
      mockUpdateFind.mockReturnValue({
        sort: () => ({
          limit: () => ({
            lean: () => Promise.resolve([]),
          }),
        }),
      });

      const req = {
        headers: {
          host: 'fallback-host.com',
        },
      };

      const feed = await generateRssFeed(SLUG, req);

      expect(feed).toContain('https://fallback-host.com/status/');
    });

    it('should only include public status updates', async () => {
      const page = makePage();
      mockPageFindOne.mockResolvedValue(page);
      mockUpdateFind.mockReturnValue({
        sort: () => ({
          limit: () => ({
            lean: () => Promise.resolve([]),
          }),
        }),
      });

      await generateRssFeed(SLUG, mockReq);

      // Verify the query filters for public visibility
      expect(mockUpdateFind).toHaveBeenCalledWith({
        status_page_id: PAGE_ID,
        visibility: 'public',
      });
    });

    it('should throw 404 for non-existent slug', async () => {
      mockPageFindOne.mockResolvedValue(null);

      await expect(generateRssFeed('bad-slug', mockReq)).rejects.toThrow(/not found/i);
    });

    it('should handle updates with special XML characters in CDATA', async () => {
      const page = makePage();
      const updates = [
        {
          _id: new Types.ObjectId(),
          title: 'Fix for <script>alert("xss")</script>',
          body: 'Body with & special < chars >',
          status: 'resolved',
          created_at: new Date('2026-03-18T10:00:00Z'),
        },
      ];

      mockPageFindOne.mockResolvedValue(page);
      mockUpdateFind.mockReturnValue({
        sort: () => ({
          limit: () => ({
            lean: () => Promise.resolve(updates),
          }),
        }),
      });

      const feed = await generateRssFeed(SLUG, mockReq);

      // CDATA wrapping should preserve the raw content
      expect(feed).toContain('<![CDATA[Fix for <script>alert("xss")</script>]]>');
    });

    it('should handle empty body in updates gracefully', async () => {
      const page = makePage();
      const updates = [
        {
          _id: new Types.ObjectId(),
          title: 'Quick update',
          body: '',
          status: 'informational',
          created_at: new Date('2026-03-18T10:00:00Z'),
        },
      ];

      mockPageFindOne.mockResolvedValue(page);
      mockUpdateFind.mockReturnValue({
        sort: () => ({
          limit: () => ({
            lean: () => Promise.resolve(updates),
          }),
        }),
      });

      const feed = await generateRssFeed(SLUG, mockReq);

      expect(feed).toContain('<description><![CDATA[]]></description>');
    });
  });
});
