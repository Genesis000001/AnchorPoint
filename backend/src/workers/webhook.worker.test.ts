import { WebhookWorker } from './webhook.worker';
import type { WebhookAttemptRecord } from './webhook.worker';
import { calculateFullJitterBackoff } from '../services/webhook.service';
import type { Job } from 'bullmq';
import type { WebhookRetryJobData } from '../services/webhookRetry.queue';

describe('WebhookWorker & Full Jitter Backoff', () => {
  describe('calculateFullJitterBackoff', () => {
    it('calculates randomized full jitter within expected bounds', () => {
      const initial = 2000;
      const max = 3600000;

      for (let attempt = 1; attempt <= 5; attempt++) {
        const expectedMax = Math.min(max, initial * 2 ** (attempt - 1));
        const delay = calculateFullJitterBackoff(attempt, initial, max);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(expectedMax);
      }
    });

    it('respects the maximum delay cap', () => {
      const initial = 2000;
      const max = 10000; // 10s cap
      const delay = calculateFullJitterBackoff(10, initial, max);
      expect(delay).toBeLessThanOrEqual(10000);
    });
  });

  describe('WebhookWorker processJob', () => {
    let worker: WebhookWorker;

    beforeEach(() => {
      worker = new WebhookWorker();
    });

    it('processes successful webhook retry and records latency history', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('ok'),
      } as any);

      const mockJob = {
        id: 'job_123',
        attemptsMade: 1,
        opts: { attempts: 5 },
        data: {
          transactionId: 'tx_123',
          protocol: 'sep24',
          callbackUrl: 'https://partner.io/webhook',
          idempotencyKey: 'sep24:tx_123:PENDING->COMPLETED',
          deliveryHash: 'hash_123',
          payload: JSON.stringify({ event: 'transaction.status_changed' }),
          attempt: 2,
        },
      } as unknown as Job<WebhookRetryJobData>;

      const result = await worker.processJob(mockJob);

      expect(result.delivered).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(worker.attemptHistories.length).toBe(1);
      expect(worker.attemptHistories[0].isDeadLetter).toBe(false);
      expect(worker.attemptHistories[0].latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('records failure and fires dead letter alert on max attempts', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      } as any);

      const alertSpy = jest.spyOn(worker, 'fireDeadLetterAlert');

      const mockJob = {
        id: 'job_999',
        attemptsMade: 4, // 5th attempt
        opts: { attempts: 5 },
        data: {
          transactionId: 'tx_999',
          protocol: 'sep24',
          callbackUrl: 'https://partner.io/webhook',
          idempotencyKey: 'sep24:tx_999:PENDING->FAILED',
          deliveryHash: 'hash_999',
          payload: JSON.stringify({ event: 'transaction.status_changed' }),
          attempt: 5,
        },
      } as unknown as Job<WebhookRetryJobData>;

      await expect(worker.processJob(mockJob)).rejects.toThrow(/HTTP 500/);

      expect(worker.attemptHistories.length).toBe(1);
      expect(worker.attemptHistories[0].isDeadLetter).toBe(true);
      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ isDeadLetter: true }),
        'https://partner.io/webhook'
      );
    });
  });
});
