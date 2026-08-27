import { QuoteStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import logger from '../utils/logger';

/**
 * Marks firm SEP-38 quotes whose `expiresAt` has passed as EXPIRED.
 * Only rows still `PENDING` are affected, so repeated runs are idempotent.
 */
export async function expireStaleQuotes(now: Date = new Date()): Promise<number> {
  const result = await prisma.quote.updateMany({
    where: {
      status: QuoteStatus.PENDING,
      expiresAt: { not: null, lte: now },
    },
    data: { status: QuoteStatus.EXPIRED },
  });

  if (result.count > 0) {
    logger.info(`Marked ${result.count} SEP-38 quote(s) as expired`);
  }

  return result.count;
}
