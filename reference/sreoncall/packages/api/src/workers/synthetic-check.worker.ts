import { getDueChecks, executeAndRecord } from '../services/synthetic-check.service';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = 5_000; // check for due items every 5 seconds
let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return; // prevent overlap
  running = true;
  try {
    const checks = await getDueChecks();
    if (checks.length > 0) {
      logger.debug(`Synthetic check worker: running ${checks.length} due checks`);
      // Run in parallel with a concurrency cap of 20
      const CONCURRENCY = 20;
      for (let i = 0; i < checks.length; i += CONCURRENCY) {
        await Promise.allSettled(
          checks.slice(i, i + CONCURRENCY).map((c) => executeAndRecord(c as any)),
        );
      }
    }
  } catch (err: any) {
    logger.error('Synthetic check worker tick failed', { error: err.message });
  } finally {
    running = false;
  }
}

export function startSyntheticCheckWorker(): void {
  logger.info('Starting synthetic check worker');
  // Run immediately on startup, then on interval
  tick().catch(() => {});
  timer = setInterval(() => tick().catch(() => {}), POLL_INTERVAL_MS);
}

export function stopSyntheticCheckWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  logger.info('Synthetic check worker stopped');
}
