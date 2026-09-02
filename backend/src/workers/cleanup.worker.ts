import cron, { ScheduledTask } from 'node-cron';
import { expireStaleQuotes } from '../services/sep38.service';
import logger from '../utils/logger';

/**
 * Periodically marks expired SEP-38 firm quotes so they can no longer be used
 * to create a transaction. Runs every 10 seconds since firm quotes are
 * typically only valid for a short window.
 */
export class CleanupWorker {
  private task: ScheduledTask | null = null;

  start(): void {
    this.task = cron.schedule('*/10 * * * * *', async () => {
      try {
        await expireStaleQuotes();
      } catch (error) {
        logger.error('Failed to run SEP-38 quote cleanup task', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    logger.info('SEP-38 quote cleanup worker started (running every 10 seconds)');
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    logger.info('SEP-38 quote cleanup worker stopped');
  }
}

export const cleanupWorker = new CleanupWorker();
