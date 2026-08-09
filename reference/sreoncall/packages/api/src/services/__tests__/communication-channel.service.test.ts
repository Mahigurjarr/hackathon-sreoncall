import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

// Reusable test ObjectIds
const TENANT_ID = new Types.ObjectId().toHexString();
const CHANNEL_ID = new Types.ObjectId().toHexString();
const INSTALL_ID = new Types.ObjectId().toHexString();

// ─── Mock Mongoose models ───────────────────────────────────────────────

const mockCreate = vi.fn();
const mockFindSorted = vi.fn();
const mockFindOne = vi.fn();
const mockFindOneAndUpdate = vi.fn();

vi.mock('../../models/communication-channel.model', () => ({
  CommunicationChannel: {
    create: (...args: any[]) => mockCreate(...args),
    find: (...args: any[]) => ({ sort: () => mockFindSorted() }),
    findOne: (...args: any[]) => mockFindOne(...args),
    findOneAndUpdate: (...args: any[]) => mockFindOneAndUpdate(...args),
  },
}));

vi.mock('../../utils/encryption', () => ({
  encryptToken: vi.fn((token: string) => `encrypted_${token}`),
}));

vi.mock('../../utils/crypto', () => ({
  sha256: vi.fn((value: string) => `sha256_${value}`),
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Import after mocks ────────────────────────────────────────────────

import {
  createChannel,
  listChannels,
  updateChannel,
  deleteChannel,
  getChannelById,
  findChannelByExternal,
} from '../communication-channel.service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('communication-channel.service', () => {
  describe('createChannel — manual (with token)', () => {
    it('should encrypt token and hash signing secret for manual channels', async () => {
      const fakeChannel = {
        _id: { toString: () => CHANNEL_ID },
        platform: 'teams',
        external_channel_id: 'teams-ch-1',
        display_name: 'SRE Support',
        access_token_encrypted: 'encrypted_some-token',
        token_prefix: 'some-tok...',
        signing_secret_hash: 'sha256_my-secret',
        is_active: true,
      };
      mockCreate.mockResolvedValue(fakeChannel);

      const { channel } = await createChannel({
        consumer_tenant_id: TENANT_ID,
        platform: 'teams',
        external_channel_id: 'teams-ch-1',
        display_name: 'SRE Support',
        access_token: 'some-token',
        signing_secret: 'my-secret',
      });

      expect(mockCreate).toHaveBeenCalledOnce();
      const doc = mockCreate.mock.calls[0][0];
      expect(doc.platform).toBe('teams');
      expect(doc.channel_role).toBe('bidirectional');
      expect(doc.access_token_encrypted).toBe('encrypted_some-token');
      expect(doc.token_prefix).toBe('some-tok...');
      expect(doc.signing_secret_hash).toBe('sha256_my-secret');
      expect(doc.installation_id).toBeUndefined();
      expect(channel).toBe(fakeChannel);
    });
  });

  describe('createChannel — centralized (with installation_id)', () => {
    it('should set installation_id and skip token fields', async () => {
      const fakeChannel = {
        _id: { toString: () => CHANNEL_ID },
        platform: 'slack',
        external_channel_id: 'C001',
        display_name: '#general',
        installation_id: INSTALL_ID,
        is_active: true,
      };
      mockCreate.mockResolvedValue(fakeChannel);

      const { channel } = await createChannel({
        consumer_tenant_id: TENANT_ID,
        platform: 'slack',
        external_channel_id: 'C001',
        display_name: '#general',
        installation_id: INSTALL_ID,
      });

      expect(mockCreate).toHaveBeenCalledOnce();
      const doc = mockCreate.mock.calls[0][0];
      expect(doc.platform).toBe('slack');
      expect(doc.channel_role).toBe('bidirectional');
      expect(doc.installation_id).toBeDefined();
      // No token fields set
      expect(doc.access_token_encrypted).toBeUndefined();
      expect(doc.token_prefix).toBeUndefined();
      expect(doc.signing_secret_hash).toBeUndefined();
      expect(channel).toBe(fakeChannel);
    });
  });

  describe('listChannels', () => {
    it('should query by consumer_tenant_id with deleted_at null', async () => {
      const fakeChannels = [{ _id: 'ch_1' }, { _id: 'ch_2' }];
      mockFindSorted.mockResolvedValue(fakeChannels);

      const result = await listChannels(TENANT_ID);
      expect(result).toBe(fakeChannels);
    });
  });

  describe('deleteChannel', () => {
    it('should soft-delete by setting deleted_at and is_active=false', async () => {
      const fakeChannel = { _id: CHANNEL_ID, deleted_at: new Date(), is_active: false };
      mockFindOneAndUpdate.mockResolvedValue(fakeChannel);

      const result = await deleteChannel(CHANNEL_ID, TENANT_ID);

      expect(mockFindOneAndUpdate).toHaveBeenCalledOnce();
      const [filter, update] = mockFindOneAndUpdate.mock.calls[0];
      expect(filter.deleted_at).toBeNull();
      expect(update.$set.is_active).toBe(false);
      expect(update.$set.deleted_at).toBeInstanceOf(Date);
      expect(result).toBe(fakeChannel);
    });

    it('should return null if channel not found', async () => {
      mockFindOneAndUpdate.mockResolvedValue(null);
      const result = await deleteChannel(CHANNEL_ID, TENANT_ID);
      expect(result).toBeNull();
    });
  });

  describe('updateChannel', () => {
    it('should allow updating channel role', async () => {
      const fakeChannel = { _id: CHANNEL_ID, channel_role: 'notify_only' };
      mockFindOneAndUpdate.mockResolvedValue(fakeChannel);

      const result = await updateChannel(CHANNEL_ID, TENANT_ID, { channel_role: 'notify_only' });

      expect(mockFindOneAndUpdate).toHaveBeenCalledOnce();
      const [, update] = mockFindOneAndUpdate.mock.calls[0];
      expect(update.$set.channel_role).toBe('notify_only');
      expect(result).toBe(fakeChannel);
    });
  });

  describe('getChannelById', () => {
    it('should find channel by _id with deleted_at null', async () => {
      const fakeChannel = { _id: CHANNEL_ID };
      mockFindOne.mockResolvedValue(fakeChannel);

      const result = await getChannelById(CHANNEL_ID);

      expect(mockFindOne).toHaveBeenCalledOnce();
      const filter = mockFindOne.mock.calls[0][0];
      expect(filter.deleted_at).toBeNull();
      expect(result).toBe(fakeChannel);
    });
  });

  describe('findChannelByExternal', () => {
    it('should find active channel by platform and external_channel_id', async () => {
      const fakeChannel = { _id: CHANNEL_ID, platform: 'slack', external_channel_id: 'C001' };
      mockFindOne.mockResolvedValue(fakeChannel);

      const result = await findChannelByExternal('slack', 'C001');

      expect(mockFindOne).toHaveBeenCalledOnce();
      const filter = mockFindOne.mock.calls[0][0];
      expect(filter.platform).toBe('slack');
      expect(filter.external_channel_id).toBe('C001');
      expect(filter.is_active).toBe(true);
      expect(filter.deleted_at).toBeNull();
      expect(result).toBe(fakeChannel);
    });
  });
});
