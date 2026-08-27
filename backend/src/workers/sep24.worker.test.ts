import { sep24Worker } from './sep24.worker';
import { Sep24Service } from '../services/sep24.service';
import prisma from '../lib/prisma';

jest.mock('../lib/prisma', () => ({
  transaction: {
    update: jest.fn(),
    findMany: jest.fn(),
  },
}));

jest.mock('../services/sep24.service', () => ({
  Sep24Service: {
    notifyClaimableBalance: jest.fn(),
    getCallback: jest.fn(),
  },
}));

describe('Sep24Worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processDepositClaimable', () => {
    it('should update transaction status and notify claimable balance', async () => {
      (prisma.transaction.update as jest.Mock).mockResolvedValueOnce({
        id: 'tx-123',
        status: 'PENDING_EXTERNAL',
      });

      (Sep24Service.notifyClaimableBalance as jest.Mock).mockResolvedValueOnce({
        delivered: true,
        attempts: 1,
        idempotencyKey: 'sep24:tx-123:claimable',
      });

      const result = await sep24Worker.processDepositClaimable(
        'tx-123',
        'claimable-id-456',
        'https://partner.com/cb'
      );

      expect(result).toBe(true);
      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-123' },
        data: { status: 'PENDING_EXTERNAL' },
      });
      expect(Sep24Service.notifyClaimableBalance).toHaveBeenCalledWith(
        'tx-123',
        'claimable-id-456',
        'https://partner.com/cb'
      );
    });

    it('should return false if notification fails', async () => {
      (prisma.transaction.update as jest.Mock).mockResolvedValueOnce({
        id: 'tx-123',
        status: 'PENDING_EXTERNAL',
      });

      (Sep24Service.notifyClaimableBalance as jest.Mock).mockRejectedValueOnce(
        new Error('Delivery error')
      );

      const result = await sep24Worker.processDepositClaimable(
        'tx-123',
        'claimable-id-456'
      );

      expect(result).toBe(false);
    });
  });

  describe('processPendingClaimableDeposits', () => {
    it('should query pending deposits and notify subscribers with stored callback', async () => {
      (prisma.transaction.findMany as jest.Mock).mockResolvedValueOnce([
        { id: 'tx-1', type: 'DEPOSIT', status: 'PENDING_EXTERNAL' },
      ]);

      (Sep24Service.getCallback as jest.Mock).mockResolvedValueOnce({
        callbackUrl: 'https://client.com/webhook',
        claimableBalanceId: 'claim-bal-1',
        kind: 'deposit',
      });

      (Sep24Service.notifyClaimableBalance as jest.Mock).mockResolvedValueOnce({
        delivered: true,
      });

      const count = await sep24Worker.processPendingClaimableDeposits();
      expect(count).toBe(1);
      expect(Sep24Service.notifyClaimableBalance).toHaveBeenCalledWith(
        'tx-1',
        'claim-bal-1',
        'https://client.com/webhook'
      );
    });
  });
});
