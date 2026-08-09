import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';

const TENANT_ID = new Types.ObjectId();
const INSTALLER_ID = new Types.ObjectId();
const INCIDENT_ID = new Types.ObjectId();

const mockSlackInstallFindOne = vi.fn();
const mockCommChannelFindOne = vi.fn();
const mockIncidentFindOne = vi.fn();
const mockIncidentUpdateOne = vi.fn();
const mockUserFindOne = vi.fn();
const mockCreateIncident = vi.fn();
const mockResolveIncident = vi.fn();

vi.mock('../../models/slack-installation.model', () => ({
  SlackInstallation: {
    findOne: (...args: any[]) => mockSlackInstallFindOne(...args),
  },
}));

vi.mock('../../models/communication-channel.model', () => ({
  CommunicationChannel: {
    findOne: (...args: any[]) => mockCommChannelFindOne(...args),
  },
}));

vi.mock('../../models/incident.model', () => ({
  Incident: {
    findOne: (...args: any[]) => mockIncidentFindOne(...args),
    updateOne: (...args: any[]) => mockIncidentUpdateOne(...args),
  },
}));

vi.mock('../../models/user.model', () => ({
  User: {
    findOne: (...args: any[]) => mockUserFindOne(...args),
  },
}));

vi.mock('../incident.service', () => ({
  createIncident: (...args: any[]) => mockCreateIncident(...args),
  resolveIncident: (...args: any[]) => mockResolveIncident(...args),
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { ingestSlackAlertMessage } from '../slack-alert-ingestion.service';

function asLeanQuery<T>(value: T) {
  return {
    lean: vi.fn().mockResolvedValue(value),
  };
}

function asSelectLeanQuery<T>(value: T) {
  return {
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue(value),
    }),
  };
}

function asSelectQuery<T>(value: T) {
  return {
    select: vi.fn().mockResolvedValue(value),
  };
}

function makeSlackPayload(titleLine: string, messageTs: string) {
  return {
    team_id: 'T123',
    event: {
      type: 'message',
      channel: 'C123',
      ts: messageTs,
      subtype: 'bot_message',
      bot_id: 'B123',
      bot_profile: { name: 'Groundcover Alerts' },
      attachments: [
        {
          color: '#DC2626',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${titleLine}\nSilence :no_bell: | Investigate :mag: | See Monitor :chart_with_upwards_trend:`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*Labels:*\n- tenant_id=69facbf7934c9acfa2847511\n- cluster=erag-dev-gigaspaces-net\n- monitor_name=PostgreSQL Query Errors Monitor\n- namespace=zitadel-dev\n- role=server\n- span_name=insert into eventstore.unique_constraints ( instance_id, unique_type, unique_field ) values ( ? )\n- statusCode=23505\n- workload=zitadel-db',
              },
            },
          ],
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockSlackInstallFindOne.mockReturnValue(asLeanQuery({
    consumer_tenant_id: TENANT_ID,
    installed_by_user_id: INSTALLER_ID,
  }));
  mockCommChannelFindOne.mockReturnValue(asLeanQuery({
    _id: new Types.ObjectId(),
    consumer_tenant_id: TENANT_ID,
    platform: 'slack',
    external_channel_id: 'C123',
    is_active: true,
  }));
  mockUserFindOne.mockReturnValue({
    sort: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue({ _id: INSTALLER_ID }),
  });
  mockIncidentUpdateOne.mockResolvedValue({ acknowledged: true });
  mockCreateIncident.mockResolvedValue({
    _id: INCIDENT_ID,
    number: 42,
  });
  mockResolveIncident.mockResolvedValue({
    _id: INCIDENT_ID,
    status: 'resolved',
  });
});

describe('slack-alert-ingestion.service', () => {
  it('creates a firing incident with normalized title, description, and identity key', async () => {
    mockIncidentFindOne.mockReturnValueOnce(asSelectLeanQuery(null));

    await ingestSlackAlertMessage(makeSlackPayload('Firing: PostgreSQL Query Errors Monitor', '1710000000.100'));

    expect(mockCreateIncident).toHaveBeenCalledOnce();
    const input = mockCreateIncident.mock.calls[0][0];
    expect(input.title).toBe('PostgreSQL Query Errors Monitor');
    expect(input.description).toContain('Firing: PostgreSQL Query Errors Monitor');
    expect(input.description).toContain('Alert Labels:');
    expect(input.description).toContain('- monitorname=PostgreSQL Query Errors Monitor');
    expect(input.custom_fields.slack_alert.identity_key).toBe('groundcover_alerts|PostgreSQL Query Errors Monitor|erag-dev-gigaspaces-net|zitadel-dev'.toLowerCase());
    expect(input.custom_fields.slack_alert.status).toBe('firing');
  });

  it('resolves an open incident for a resolved payload and does not create a new one', async () => {
    mockIncidentFindOne
      .mockReturnValueOnce(asSelectLeanQuery(null))
      .mockReturnValueOnce(asSelectQuery({ _id: INCIDENT_ID }));

    await ingestSlackAlertMessage(makeSlackPayload('Resolved: PostgreSQL Query Errors Monitor', '1710000000.200'));

    expect(mockCreateIncident).not.toHaveBeenCalled();
    expect(mockResolveIncident).toHaveBeenCalledOnce();
    expect(mockResolveIncident.mock.calls[0][1]).toBe(INCIDENT_ID.toString());
    expect(mockIncidentUpdateOne).toHaveBeenCalledOnce();
    const update = mockIncidentUpdateOne.mock.calls[0][1];
    expect(update.$set.custom_fields.slack_alert.identity_key).toBe('groundcover_alerts|postgresql query errors monitor|erag-dev-gigaspaces-net|zitadel-dev');
    expect(update.$set.custom_fields.slack_alert.status).toBe('resolved');
    expect(update.$set.custom_fields.slack_alert.title).toBe('PostgreSQL Query Errors Monitor');
  });

  it('skips safely when a resolved payload has no matching open incident', async () => {
    mockIncidentFindOne
      .mockReturnValueOnce(asSelectLeanQuery(null))
      .mockReturnValueOnce(asSelectQuery(null));

    await ingestSlackAlertMessage(makeSlackPayload('Resolved: PostgreSQL Query Errors Monitor', '1710000000.300'));

    expect(mockCreateIncident).not.toHaveBeenCalled();
    expect(mockResolveIncident).not.toHaveBeenCalled();
  });

  it('skips duplicate slack events', async () => {
    mockIncidentFindOne.mockReturnValueOnce(asSelectLeanQuery({ _id: INCIDENT_ID }));

    await ingestSlackAlertMessage(makeSlackPayload('Firing: PostgreSQL Query Errors Monitor', '1710000000.400'));

    expect(mockCreateIncident).not.toHaveBeenCalled();
    expect(mockResolveIncident).not.toHaveBeenCalled();
  });

  it('ignores notify-only linked channels for Slack ingestion', async () => {
    mockCommChannelFindOne.mockReturnValueOnce(asLeanQuery(null));

    await ingestSlackAlertMessage(makeSlackPayload('Firing: PostgreSQL Query Errors Monitor', '1710000000.500'));

    expect(mockCommChannelFindOne).toHaveBeenCalledOnce();
    const filter = mockCommChannelFindOne.mock.calls[0][0];
    expect(filter.channel_role).toEqual({ $ne: 'notify_only' });
    expect(mockCreateIncident).not.toHaveBeenCalled();
    expect(mockResolveIncident).not.toHaveBeenCalled();
  });
});
