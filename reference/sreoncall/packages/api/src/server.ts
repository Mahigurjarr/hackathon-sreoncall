// Must be imported before any other module so OTel patches Node internals first
import './instrumentation';
import http from 'http';
import cron from 'node-cron';
import { loadConfig } from './config/index';
import { connectDatabase, disconnectDatabase } from './config/database';
import { connectRedis, disconnectRedis } from './config/redis';
import { connectNats, disconnectNats } from './config/nats';
import { initMinioBuckets } from './config/minio';
import { initMeiliIndexes } from './config/meilisearch';
import { createApp } from './app';
import { setupWebSocketGateway } from './websocket/gateway';
import { startWorkers, stopWorkers } from './workers/index';
import { seedPlatform } from './scripts/seed';
import { seedAgentDefinitions } from './seeds/agent-definitions.seed';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  // Load and validate config
  const config = loadConfig();
  logger.info('Configuration loaded', { env: config.NODE_ENV, port: config.PORT });

  // Connect to infrastructure services
  await connectDatabase();
  await connectRedis();

  try {
    await connectNats();
  } catch (err: any) {
    logger.warn('NATS connection failed, continuing without event streaming', { error: err.message });
  }

  try {
    await initMinioBuckets();
  } catch (err: any) {
    logger.warn('MinIO initialization failed, file uploads may not work', { error: err.message });
  }

  try {
    await initMeiliIndexes();
  } catch (err: any) {
    logger.warn('Meilisearch initialization failed, search may not work', { error: err.message });
  }

  // Run seed
  try {
    await seedPlatform();
  } catch (err: any) {
    logger.error('Seed failed', { error: err.message });
  }

  // Seed agent definitions (idempotent — runs independently of platform seed)
  try {
    await seedAgentDefinitions();
  } catch (err: any) {
    logger.error('Agent definitions seed failed', { error: err.message });
  }

  // Create Express app
  const app = createApp();
  const server = http.createServer(app);

  // Setup WebSocket
  setupWebSocketGateway(server);

  // Start workers
  try {
    await startWorkers();
  } catch (err: any) {
    logger.warn('Worker startup failed', { error: err.message });
  }

  // Start listening
  server.listen(config.PORT, () => {
    logger.info(`SREonCall API server listening on port ${config.PORT}`, {
      env: config.NODE_ENV,
      port: config.PORT,
    });
  });

  // Activation code expiry cron — runs daily at midnight UTC
  cron.schedule('0 0 * * *', async () => {
    try {
      const { expireStaleCode } = await import('./services/activation-code.service');
      const count = await expireStaleCode();
      if (count > 0) logger.info(`Expired ${count} stale activation codes`);
    } catch (err) {
      logger.error('Activation code expiry job failed', { err });
    }
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);

    server.close(() => {
      logger.info('HTTP server closed');
    });

    try {
      await stopWorkers();
      await disconnectNats();
      await disconnectRedis();
      await disconnectDatabase();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err: any) {
      logger.error('Error during shutdown', { error: err.message });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

main().catch((err) => {
  logger.error('Fatal startup error', { error: err.message, stack: err.stack });
  process.exit(1);
});
