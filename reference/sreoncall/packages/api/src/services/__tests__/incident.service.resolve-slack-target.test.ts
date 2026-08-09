import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

const TENANT_ID = new Types.ObjectId();
const INSTALL_ID = new Types.ObjectId();

const mockTenantIntegrationFindOne = vi.fn();
const mockSlackInstallationFindOne = vi.fn();
const mockCommunicationChannelFindOne = vi.fn();

vi.mock('../../models/tenant-integration.model', () => ({
  TenantIntegration: {
    findOne: (...args: any[]) => mockTenantIntegrationFindOne(...args),
  },
}));

vi.mock('../../models/slack-installation.model', () => ({
  SlackInstallation: {
    findOne: (...args: any[]) => mockSlackInstallationFindOne(...args),
  },
}));

vi.mock('../../models/communication-channel.model', () => ({
  CommunicationChannel: {
    findOne: (...args: any[]) => mockCommunicationChannelFindOne(...args),
  },
}));

vi.mock('../../utils/encryption', () => ({
  decryptToken: vi.fn((value: string) => `decrypted_${value}`),
  encryptToken: vi.fn((value: string) => `encrypted_${value}`),
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { resolveSlackTarget } from '../incident.service';

beforeEach(() => {
  vi.clearAllMocks();
});

function asLeanQuery<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
  };
}

describe('incident.service resolveSlackTarget', () => {
  it('prefers notify_only channels for installation-backed Slack notifications', async () => {
    mockTenantIntegrationFindOne.mockResolvedValue(null);
    mockSlackInstallationFindOne.mockReturnValue(asLeanQuery({
      _id: INSTALL_ID,
      bot_token_encrypted: 'bot-token',
    }));
    mockCommunicationChannelFindOne
      .mockReturnValueOnce(asLeanQuery({ external_channel_id: 'C_NOTIFY' }))
      .mockResolvedValueOnce({ external_channel_id: 'C_BIDIR' });

    const target = await resolveSlackTarget(TENANT_ID);

    expect(target).toEqual({
      token: 'decrypted_bot-token',
      channelId: 'C_NOTIFY',
    });
    expect(mockCommunicationChannelFindOne).toHaveBeenCalledTimes(1);
    expect(mockCommunicationChannelFindOne.mock.calls[0][0]).toMatchObject({
      installation_id: INSTALL_ID,
      channel_role: 'notify_only',
    });
  });
});
