import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

// Reusable test ObjectIds
const TENANT_ID = new Types.ObjectId().toHexString();
const INSTALL_ID = new Types.ObjectId().toHexString();

// ─── Mock Mongoose models ───────────────────────────────────────────────

const mockFindOneAndUpdate = vi.fn();
const mockFindOne = vi.fn();
const mockFindSorted = vi.fn();
const mockUpdateMany = vi.fn();

vi.mock('../../models/slack-installation.model', () => ({
  SlackInstallation: {
    findOneAndUpdate: (...args: any[]) => mockFindOneAndUpdate(...args),
    findOne: (...args: any[]) => mockFindOne(...args),
    find: (...args: any[]) => ({ sort: () => mockFindSorted() }),
  },
}));

vi.mock('../../models/communication-channel.model', () => ({
  CommunicationChannel: {
    updateMany: (...args: any[]) => mockUpdateMany(...args),
  },
}));

vi.mock('../../utils/encryption', () => ({
  encryptToken: vi.fn((token: string) => `encrypted_${token}`),
  decryptToken: vi.fn((encrypted: string) => encrypted.replace('encrypted_', '')),
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
  createInstallation,
  getInstallationById,
  getInstallationByTeamId,
  listInstallations,
  deleteInstallation,
  fetchSlackChannels,
} from '../slack-installation.service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('slack-installation.service', () => {
  describe('createInstallation', () => {
    it('should upsert a slack installation with encrypted bot token', async () => {
      const fakeInstallation = {
        _id: { toString: () => INSTALL_ID },
        team_id: 'T12345',
        team_name: 'Test Workspace',
        bot_token_encrypted: 'encrypted_xoxb-fake-token',
        bot_user_id: 'U99999',
        scopes: 'channels:read,chat:write',
        is_active: true,
      };
      mockFindOneAndUpdate.mockResolvedValue(fakeInstallation);

      const result = await createInstallation({
        consumer_tenant_id: TENANT_ID,
        team_id: 'T12345',
        team_name: 'Test Workspace',
        bot_token: 'xoxb-fake-token',
        bot_user_id: 'U99999',
        scopes: 'channels:read,chat:write',
      });

      expect(mockFindOneAndUpdate).toHaveBeenCalledOnce();
      const [filter, update, options] = mockFindOneAndUpdate.mock.calls[0];
      expect(filter.team_id).toBe('T12345');
      expect(filter.deleted_at).toBeNull();
      expect(update.$set.bot_token_encrypted).toBe('encrypted_xoxb-fake-token');
      expect(update.$set.team_name).toBe('Test Workspace');
      expect(update.$setOnInsert.team_id).toBe('T12345');
      expect(options.upsert).toBe(true);
      expect(options.new).toBe(true);
      expect(result).toBe(fakeInstallation);
    });
  });

  describe('getInstallationById', () => {
    it('should find installation by _id with deleted_at null', async () => {
      const fakeInstallation = { _id: INSTALL_ID, team_id: 'T12345' };
      mockFindOne.mockResolvedValue(fakeInstallation);

      const result = await getInstallationById(INSTALL_ID);

      expect(mockFindOne).toHaveBeenCalledOnce();
      const filter = mockFindOne.mock.calls[0][0];
      expect(filter.deleted_at).toBeNull();
      expect(result).toBe(fakeInstallation);
    });

    it('should return null when not found', async () => {
      mockFindOne.mockResolvedValue(null);
      const result = await getInstallationById(INSTALL_ID);
      expect(result).toBeNull();
    });
  });

  describe('getInstallationByTeamId', () => {
    it('should find active installation by team_id', async () => {
      const fakeInstallation = { _id: INSTALL_ID, team_id: 'T12345' };
      mockFindOne.mockResolvedValue(fakeInstallation);

      const result = await getInstallationByTeamId('T12345');

      expect(mockFindOne).toHaveBeenCalledOnce();
      const filter = mockFindOne.mock.calls[0][0];
      expect(filter.team_id).toBe('T12345');
      expect(filter.is_active).toBe(true);
      expect(filter.deleted_at).toBeNull();
      expect(result).toBe(fakeInstallation);
    });
  });

  describe('listInstallations', () => {
    it('should list active installations for a tenant', async () => {
      const fakeList = [{ _id: INSTALL_ID }];
      mockFindSorted.mockResolvedValue(fakeList);

      const result = await listInstallations(TENANT_ID);
      expect(result).toBe(fakeList);
    });
  });

  describe('deleteInstallation', () => {
    it('should soft-delete installation and cascade to linked channels', async () => {
      const fakeInstallation = {
        _id: INSTALL_ID,
        team_id: 'T12345',
      };
      mockFindOneAndUpdate.mockResolvedValue(fakeInstallation);
      mockUpdateMany.mockResolvedValue({ modifiedCount: 2 });

      const result = await deleteInstallation(INSTALL_ID, TENANT_ID);

      expect(mockFindOneAndUpdate).toHaveBeenCalledOnce();
      const [, update] = mockFindOneAndUpdate.mock.calls[0];
      expect(update.$set.is_active).toBe(false);
      expect(update.$set.deleted_at).toBeInstanceOf(Date);

      // Should cascade soft-delete to channels
      expect(mockUpdateMany).toHaveBeenCalledOnce();
      const [channelFilter, channelUpdate] = mockUpdateMany.mock.calls[0];
      expect(channelFilter.installation_id).toBe(INSTALL_ID);
      expect(channelFilter.deleted_at).toBeNull();
      expect(channelUpdate.$set.is_active).toBe(false);
      expect(channelUpdate.$set.deleted_at).toBeInstanceOf(Date);
      expect(result).toBe(fakeInstallation);
    });

    it('should return null and not cascade if installation not found', async () => {
      mockFindOneAndUpdate.mockResolvedValue(null);

      const result = await deleteInstallation(INSTALL_ID, TENANT_ID);

      expect(result).toBeNull();
      expect(mockUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe('fetchSlackChannels', () => {
    it('should decrypt bot token and call Slack API', async () => {
      const fakeInstallation = {
        _id: INSTALL_ID,
        bot_token_encrypted: 'encrypted_xoxb-token',
      };
      mockFindOne.mockResolvedValue(fakeInstallation);

      const mockFetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          channels: [
            { id: 'C001', name: 'general', is_private: false, num_members: 50, topic: { value: 'General chat' } },
            { id: 'C002', name: 'sre-support', is_private: true, num_members: 5, topic: { value: '' } },
          ],
          response_metadata: { next_cursor: '' },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await fetchSlackChannels(INSTALL_ID);

      expect(mockFetch).toHaveBeenCalledOnce();
      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain('https://slack.com/api/conversations.list');

      const fetchOptions = mockFetch.mock.calls[0][1];
      expect(fetchOptions.headers.Authorization).toBe('Bearer xoxb-token');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'C001',
        name: 'general',
        is_private: false,
        num_members: 50,
        topic: 'General chat',
      });
      expect(result[1]).toEqual({
        id: 'C002',
        name: 'sre-support',
        is_private: true,
        num_members: 5,
        topic: undefined,
      });

      vi.unstubAllGlobals();
    });

    it('should throw when installation not found', async () => {
      mockFindOne.mockResolvedValue(null);
      await expect(fetchSlackChannels(INSTALL_ID)).rejects.toThrow('Installation not found');
    });

    it('should throw when Slack API returns error', async () => {
      const fakeInstallation = {
        _id: INSTALL_ID,
        bot_token_encrypted: 'encrypted_xoxb-token',
      };
      mockFindOne.mockResolvedValue(fakeInstallation);

      const mockFetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: false, error: 'invalid_auth' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(fetchSlackChannels(INSTALL_ID)).rejects.toThrow('Slack API error: invalid_auth');

      vi.unstubAllGlobals();
    });
  });
});
