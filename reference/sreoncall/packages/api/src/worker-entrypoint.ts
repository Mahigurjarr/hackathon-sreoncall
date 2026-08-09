import { connectDatabase, disconnectDatabase } from './config/database';
import { connectRedis, disconnectRedis } from './config/redis';
import { connectNats, disconnectNats } from './config/nats';
import { startHerokuDrainWorker, stopHerokuDrainWorker } from './workers/heroku-drain.worker';

async function main() {
  await connectDatabase();
  await connectRedis();
  await connectNats();

  const shutdown = async () => {
    console.log('Shutdown signal received — draining in-flight messages...');
    try {
      await stopHerokuDrainWorker();
      await disconnectNats();
      await disconnectRedis();
      await disconnectDatabase();
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log('Starting Heroku drain worker...');
  await startHerokuDrainWorker();
}

main().catch((err) => {
  console.error('Critical failure during worker startup:', err);
  process.exit(1);
});
