import { connect, NatsConnection, JetStreamManager, JetStreamClient, RetentionPolicy, StorageType } from 'nats';
import { getConfig } from './index';
import { logger } from '../utils/logger';

let natsConnection: NatsConnection | null = null;
let jetStreamManager: JetStreamManager | null = null;
let jetStreamClient: JetStreamClient | null = null;

const STREAMS = [
  {
    name: 'TICKETS',
    subjects: ['tickets.>'],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    max_msgs: 1_000_000,
    max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
  },
  {
    name: 'NOTIFICATIONS',
    subjects: ['notifications.>'],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    max_msgs: 500_000,
    max_age: 3 * 24 * 60 * 60 * 1_000_000_000,
  },
  {
    name: 'AUDIT',
    subjects: ['audit.>'],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    max_msgs: 2_000_000,
    max_age: 30 * 24 * 60 * 60 * 1_000_000_000,
  },
  {
    name: 'SEARCH',
    subjects: ['search.>'],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    max_msgs: 1_000_000,
    max_age: 1 * 24 * 60 * 60 * 1_000_000_000,
  },
  {
    name: 'COMMUNICATIONS',
    subjects: ['comms.>'],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    max_msgs: 500_000,
    max_age: 30 * 24 * 60 * 60 * 1_000_000_000, // 30 days in nanoseconds
  },
  {
    name: 'BRIDGES',
    subjects: ['bridges.>'],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    max_msgs: 500_000,
    max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
  },
  {
    name: 'AGENTS',
    subjects: ['agents.>'],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    max_msgs: 1_000_000,
    max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
  },
  {
    name: 'INCIDENTS',
    subjects: ['incidents.>'],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    max_msgs: 1_000_000,
    max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
  },
  {
    name: 'CHANGES',
    subjects: ['changes.>'],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    max_msgs: 500_000,
    max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
  },
  {
    name: 'STATUS_PAGES',
    subjects: ['status-pages.>'],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    max_msgs: 500_000,
    max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
  },
  {
    name: 'NOTETAKER',
    subjects: ['notetaker.>'],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    max_msgs: 500_000,
    max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days in nanoseconds
  },
  {
    name: 'DRAIN',
    subjects: ['drain.>'],
    retention: RetentionPolicy.Workqueue,
    storage: StorageType.File,
    max_msgs: 500_000,
    max_age: 24 * 60 * 60 * 1_000_000_000,
  },
  {
    name: 'TENANTS',
    subjects: ['tenants.>'],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    max_msgs: 500_000,
    max_age: 30 * 24 * 60 * 60 * 1_000_000_000, // 30 days in nanoseconds
  },
];

export async function connectNats(): Promise<NatsConnection> {
  if (natsConnection) return natsConnection;

  const config = getConfig();

  // Parse credentials from URL if present (nats://user:pass@host:port)
  const natsUrl = new URL(config.NATS_URL);
  const servers = `${natsUrl.protocol}//${natsUrl.host}`;

  const connectOpts: any = {
    servers,
    name: 'sreoncall-api',
    reconnect: true,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 2000,
  };

  if (natsUrl.username) {
    connectOpts.user = decodeURIComponent(natsUrl.username);
    connectOpts.pass = decodeURIComponent(natsUrl.password);
  }

  natsConnection = await connect(connectOpts);

  logger.info('NATS connected', { server: config.NATS_URL });

  natsConnection.closed().then((err) => {
    if (err) {
      logger.error('NATS connection closed with error', { error: err.message });
    } else {
      logger.info('NATS connection closed');
    }
  });

  // Initialize JetStream
  jetStreamManager = await natsConnection.jetstreamManager();
  jetStreamClient = natsConnection.jetstream();

  // Create streams
  for (const streamConfig of STREAMS) {
    try {
      await jetStreamManager.streams.info(streamConfig.name);
      logger.info(`NATS stream "${streamConfig.name}" already exists`);
    } catch {
      await jetStreamManager.streams.add({
        name: streamConfig.name,
        subjects: streamConfig.subjects,
        retention: streamConfig.retention,
        storage: streamConfig.storage,
        max_msgs: streamConfig.max_msgs,
        max_age: streamConfig.max_age,
      });
      logger.info(`NATS stream "${streamConfig.name}" created`);
    }
  }

  return natsConnection;
}

export function getNatsConnection(): NatsConnection {
  if (!natsConnection) {
    throw new Error('NATS not connected. Call connectNats() first.');
  }
  return natsConnection;
}

export function getJetStream(): JetStreamClient {
  if (!jetStreamClient) {
    throw new Error('JetStream not initialized. Call connectNats() first.');
  }
  return jetStreamClient;
}

export function getJetStreamManager(): JetStreamManager {
  if (!jetStreamManager) {
    throw new Error('JetStreamManager not initialized. Call connectNats() first.');
  }
  return jetStreamManager;
}

export async function disconnectNats(): Promise<void> {
  if (natsConnection) {
    await natsConnection.drain();
    natsConnection = null;
    jetStreamManager = null;
    jetStreamClient = null;
    logger.info('NATS disconnected gracefully');
  }
}
