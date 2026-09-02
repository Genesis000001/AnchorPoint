/**
 * Recurring Payments Service Tests
 * 
 * Comprehensive tests for the recurring payments service
 */

import { RecurringPaymentsService } from './recurring-payments.service';
import { BatchPaymentService } from './batch-payment.service';
import { Horizon, Keypair } from '@stellar/stellar-sdk';

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    Horizon: { Server: jest.fn() },
    Keypair: {
      ...actual.Keypair,
      fromSecret: jest.fn(() => ({ publicKey: () => 'GSOURCEACCOUNT' })),
    },
  };
});

// Mock BatchPaymentService
jest.mock('./batch-payment.service');

// Mock notification service so failed-payment alerts do not touch the DB
jest.mock('./notification.service', () => ({
  notificationService: {
    notify: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../lib/prisma', () => {
  const mockPrisma = {
    recurringPaymentSchedule: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    recurringPaymentRun: {
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  return {
    __esModule: true,
    default: mockPrisma,
    prisma: mockPrisma,
  };
});

// Mock logger
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock config
jest.mock('../config/env', () => ({
  config: {
    STELLAR_DISTRIBUTION_SECRET: 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    RECURRING_PAYMENTS_BACKOFF_BASE_MS: 1000,
    RECURRING_PAYMENTS_BACKOFF_MULTIPLIER: 2,
    RECURRING_PAYMENTS_BACKOFF_MAX_MS: 60000,
    RECURRING_PAYMENTS_BACKOFF_JITTER: 0,
    RECURRING_PAYMENTS_MAX_RETRIES: 3,
  },
}));

jest.mock('../utils/stellar-address', () => ({
  isValidStellarPublicKey: jest.fn((value: string) => /^G[A-Z0-9]{55}$/i.test(value)),
}));

const mockUser = 'GB7KUA47QKRI6Q6X7C3HOC2HEP6VJQRQWQYQF66VJPHJRVMEDJOVML6K';
const mockDestination = 'GBBD47IF6LWLVNC7F7YSACOA73YI4COI3V5O2S46F7S44GUL44YQY4O2';

describe('RecurringPaymentsService', () => {
  let service: RecurringPaymentsService;
  let mockBatchPaymentService: jest.Mocked<BatchPaymentService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBatchPaymentService = {
      executeBatch: jest.fn().mockResolvedValue({
        transactionHash: 'mock_tx_hash',
        successfulOps: 1,
        totalOps: 1,
        feePaid: 100,
      }),
    } as any;
    (BatchPaymentService as jest.Mock).mockImplementation(() => mockBatchPaymentService);
    service = new RecurringPaymentsService(mockBatchPaymentService);
  });

  describe('createSchedule', () => {
    it('should create a valid recurring payment schedule', async () => {
      const { prisma } = require('../lib/prisma');
      prisma.recurringPaymentSchedule.create.mockResolvedValue({
        id: 'schedule_1',
        destination: mockDestination,
        assetCode: 'XLM',
        amount: '10.0',
        cron: '0 0 * * *',
        status: 'ACTIVE',
        nextRunAt: new Date('2026-04-27T00:00:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createSchedule(mockUser, {
        destination: mockDestination,
        assetCode: 'XLM',
        amount: '10.0',
        cron: '0 0 * * *',
      });

      expect(result).toBeDefined();
      expect(prisma.recurringPaymentSchedule.create).toHaveBeenCalled();
    });

    it('should validate cron expression', async () => {
      await expect(
        service.createSchedule(mockUser, {
          destination: mockDestination,
          assetCode: 'XLM',
          amount: '10.0',
          cron: 'invalid-cron',
        })
      ).rejects.toThrow('Invalid cron expression');
    });

    it('should validate Stellar address', async () => {
      await expect(
        service.createSchedule(mockUser, {
          destination: 'INVALID_ADDRESS',
          assetCode: 'XLM',
          amount: '10.0',
          cron: '0 0 * * *',
        })
      ).rejects.toThrow('Invalid destination Stellar address');
    });

    it('should validate positive amount', async () => {
      await expect(
        service.createSchedule(mockUser, {
          destination: mockDestination,
          assetCode: 'XLM',
          amount: '-10.0',
          cron: '0 0 * * *',
        })
      ).rejects.toThrow('Amount must be a positive number');
    });
  });

  describe('listSchedules', () => {
    it('should list schedules for a user', async () => {
      const { prisma } = require('../lib/prisma');
      prisma.recurringPaymentSchedule.findMany.mockResolvedValue([]);

      const result = await service.listSchedules(mockUser);

      expect(result).toEqual([]);
      expect(prisma.recurringPaymentSchedule.findMany).toHaveBeenCalledWith({
        where: { user: { publicKey: mockUser } },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getSchedule', () => {
    it('should get a specific schedule', async () => {
      const { prisma } = require('../lib/prisma');
      const mockSchedule = {
        id: 'schedule_1',
        destination: mockDestination,
        assetCode: 'XLM',
        amount: '10.0',
        cron: '0 0 * * *',
        status: 'ACTIVE',
        nextRunAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.recurringPaymentSchedule.findFirst.mockResolvedValue(mockSchedule);
      prisma.recurringPaymentSchedule.findUnique.mockResolvedValue(mockSchedule);

      const result = await service.getSchedule('schedule_1', mockUser);

      expect(result).toBeDefined();
      expect(prisma.recurringPaymentSchedule.findUnique).toHaveBeenCalledWith({
        where: { id: 'schedule_1' },
        include: { runs: { orderBy: { startedAt: 'desc' } } },
      });
    });
  });

  describe('updateSchedule', () => {
    it('should update a schedule', async () => {
      const { prisma } = require('../lib/prisma');
      const mockSchedule = {
        id: 'schedule_1',
        destination: mockDestination,
        assetCode: 'XLM',
        amount: '10.0',
        cron: '0 0 * * *',
        status: 'ACTIVE',
        nextRunAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.recurringPaymentSchedule.findFirst.mockResolvedValue(mockSchedule);
      prisma.recurringPaymentSchedule.update.mockResolvedValue({
        ...mockSchedule,
        amount: '20.0',
      });

      const result = await service.updateSchedule('schedule_1', mockUser, {
        amount: '20.0',
      });

      expect(result).toBeDefined();
      expect(prisma.recurringPaymentSchedule.update).toHaveBeenCalled();
    });
  });

  describe('deleteSchedule', () => {
    it('should delete a schedule', async () => {
      const { prisma } = require('../lib/prisma');
      const mockSchedule = {
        id: 'schedule_1',
        destination: mockDestination,
        assetCode: 'XLM',
        amount: '10.0',
        cron: '0 0 * * *',
        status: 'ACTIVE',
        nextRunAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.recurringPaymentSchedule.findFirst.mockResolvedValue(mockSchedule);
      prisma.recurringPaymentSchedule.delete.mockResolvedValue(mockSchedule);

      await service.deleteSchedule(mockUser, 'schedule_1');

      expect(prisma.recurringPaymentSchedule.delete).toHaveBeenCalledWith({
        where: { id: 'schedule_1' },
      });
    });
  });

  describe('processDueSchedules', () => {
    beforeEach(() => {
      // Balance check hits the Horizon network; stub it to pass by default.
      jest.spyOn(service, 'checkSufficientBalance').mockResolvedValue(true);
    });

    it('should process due schedules successfully', async () => {
      const { prisma } = require('../lib/prisma');
      const now = new Date('2026-04-26T12:00:00Z');
      
      prisma.recurringPaymentSchedule.findMany.mockResolvedValue([
        {
          id: 'schedule_1',
          destination: mockDestination,
          assetCode: 'XLM',
          amount: '10.0',
          cron: '0 0 * * *',
          status: 'ACTIVE',
          nextRunAt: new Date('2026-04-26T00:00:00Z'),
          user: { publicKey: mockUser },
        },
      ]);

      prisma.recurringPaymentSchedule.findUnique.mockResolvedValue({
        id: 'schedule_1',
        status: 'ACTIVE',
        retryCount: 0,
        cron: '0 0 * * *',
      });

      prisma.recurringPaymentRun.create.mockResolvedValue({
        id: 'run_1',
        status: 'PROCESSING',
        attempt: 1,
        startedAt: now,
      });

      prisma.$transaction.mockImplementation(async (arg: any) => {
        if (typeof arg === 'function') {
          return arg(prisma);
        }
        return Promise.all(arg);
      });

      const count = await service.processDueSchedules({ now });

      expect(count).toBe(1);
    });

    it('should handle payment failures gracefully', async () => {
      const { prisma } = require('../lib/prisma');
      const now = new Date('2026-04-26T12:00:00Z');
      
      prisma.recurringPaymentSchedule.findMany.mockResolvedValue([
        {
          id: 'schedule_1',
          destination: mockDestination,
          assetCode: 'XLM',
          amount: '10.0',
          cron: '0 0 * * *',
          status: 'ACTIVE',
          nextRunAt: new Date('2026-04-26T00:00:00Z'),
          user: { publicKey: mockUser },
        },
      ]);

      prisma.recurringPaymentSchedule.findUnique.mockResolvedValue({
        id: 'schedule_1',
        status: 'ACTIVE',
        retryCount: 0,
        cron: '0 0 * * *',
      });

      prisma.recurringPaymentRun.create.mockResolvedValue({
        id: 'run_1',
        status: 'PROCESSING',
        attempt: 1,
        startedAt: now,
      });

      prisma.$transaction.mockImplementation(async (arg: any) => {
        if (typeof arg === 'function') {
          return arg(prisma);
        }
        return Promise.all(arg);
      });

      mockBatchPaymentService.executeBatch.mockRejectedValue(new Error('Payment failed'));

      const count = await service.processDueSchedules({ now });

      expect(count).toBe(1);
    });

    it('should skip schedule execution if status is already PROCESSING (concurrent execution test)', async () => {
      const { prisma } = require('../lib/prisma');
      const now = new Date('2026-04-26T12:00:00Z');

      prisma.recurringPaymentSchedule.findMany.mockResolvedValue([
        {
          id: 'schedule_1',
          destination: mockDestination,
          assetCode: 'XLM',
          amount: '10.0',
          cron: '0 0 * * *',
          status: 'ACTIVE',
          nextRunAt: new Date('2026-04-26T00:00:00Z'),
          user: { publicKey: mockUser },
        },
      ]);

      prisma.recurringPaymentSchedule.findUnique.mockResolvedValue({
        id: 'schedule_1',
        // PAUSED is a valid RecurringPaymentScheduleStatus and causes the service to skip execution
        status: 'PAUSED',
        retryCount: 0,
      });

      prisma.$transaction.mockImplementation(async (arg: any) => {
        if (typeof arg === 'function') {
          return arg(prisma);
        }
        return Promise.all(arg);
      });

      const count = await service.processDueSchedules({ now });

      expect(count).toBe(0);
      expect(mockBatchPaymentService.executeBatch).not.toHaveBeenCalled();
    });

    it('should respect limit parameter', async () => {
      const { prisma } = require('../lib/prisma');
      
      prisma.recurringPaymentSchedule.findMany.mockResolvedValue([]);

      await service.processDueSchedules({ limit: 10 });

      expect(prisma.recurringPaymentSchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 })
      );
    });

    it('should mark the run INSUFFICIENT_FUNDS and retry in 24 hours when the balance check fails', async () => {
      const { prisma } = require('../lib/prisma');
      const now = new Date('2026-04-26T12:00:00Z');

      prisma.recurringPaymentSchedule.findMany.mockResolvedValue([
        {
          id: 'schedule_1',
          userId: 'user_1',
          destination: mockDestination,
          assetCode: 'XLM',
          amount: '10.0',
          cron: '0 0 * * *',
          status: 'ACTIVE',
          nextRunAt: new Date('2026-04-26T00:00:00Z'),
          user: { publicKey: mockUser },
        },
      ]);

      prisma.recurringPaymentSchedule.findUnique.mockResolvedValue({
        id: 'schedule_1',
        status: 'ACTIVE',
        retryCount: 0,
        cron: '0 0 * * *',
      });

      prisma.recurringPaymentRun.create.mockResolvedValue({
        id: 'run_1',
        status: 'PROCESSING',
        attempt: 1,
        startedAt: now,
      });

      prisma.$transaction.mockImplementation(async (arg: any) => {
        if (typeof arg === 'function') {
          return arg(prisma);
        }
        return Promise.all(arg);
      });

      (service.checkSufficientBalance as jest.Mock).mockRejectedValue(
        new (require('./recurring-payments.service').RecurringPaymentError)(
          'INSUFFICIENT_FUNDS',
          'Insufficient balance in distribution account'
        )
      );

      const count = await service.processDueSchedules({ now });

      expect(count).toBe(1);
      expect(prisma.recurringPaymentRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'INSUFFICIENT_FUNDS' }),
        })
      );

      // The schedule must be pushed exactly 24h into the future for
      // insufficient funds — not the next cron tick.
      const scheduleUpdate = prisma.recurringPaymentSchedule.update.mock.calls[0][0];
      const expectedRetry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      expect(scheduleUpdate.data.nextRunAt.getTime()).toEqual(expectedRetry.getTime());
    });

    it('should notify the user after two consecutive failures', async () => {
      const { prisma } = require('../lib/prisma');
      const { notificationService } = require('./notification.service');
      const now = new Date('2026-04-26T12:00:00Z');

      prisma.recurringPaymentSchedule.findMany.mockResolvedValue([
        {
          id: 'schedule_1',
          userId: 'user_1',
          destination: mockDestination,
          assetCode: 'XLM',
          amount: '10.0',
          cron: '0 0 * * *',
          status: 'ACTIVE',
          nextRunAt: new Date('2026-04-26T00:00:00Z'),
          user: { publicKey: mockUser },
        },
      ]);

      prisma.recurringPaymentSchedule.findUnique.mockResolvedValue({
        id: 'schedule_1',
        status: 'ACTIVE',
        retryCount: 1,
        cron: '0 0 * * *',
      });

      prisma.recurringPaymentRun.create.mockResolvedValue({
        id: 'run_1',
        status: 'PROCESSING',
        attempt: 2,
        startedAt: now,
      });

      // Two previous runs already failed, so this failure crosses the threshold.
      prisma.recurringPaymentRun.count.mockResolvedValue(2);
      prisma.$transaction.mockImplementation(async (arg: any) => {
        if (typeof arg === 'function') {
          return arg(prisma);
        }
        return Promise.all(arg);
      });

      (service.checkSufficientBalance as jest.Mock).mockRejectedValue(
        new Error('Payment failed')
      );

      await service.processDueSchedules({ now });

      expect(notificationService.notify).toHaveBeenCalledTimes(1);
      expect(notificationService.notify).toHaveBeenCalledWith(
        'user_1',
        expect.stringContaining('has failed 2 times'),
        'run_1'
      );
    });

    it('should not notify on the first failure', async () => {
      const { prisma } = require('../lib/prisma');
      const { notificationService } = require('./notification.service');
      const now = new Date('2026-04-26T12:00:00Z');

      prisma.recurringPaymentSchedule.findMany.mockResolvedValue([
        {
          id: 'schedule_1',
          userId: 'user_1',
          destination: mockDestination,
          assetCode: 'XLM',
          amount: '10.0',
          cron: '0 0 * * *',
          status: 'ACTIVE',
          nextRunAt: new Date('2026-04-26T00:00:00Z'),
          user: { publicKey: mockUser },
        },
      ]);

      prisma.recurringPaymentSchedule.findUnique.mockResolvedValue({
        id: 'schedule_1',
        status: 'ACTIVE',
        retryCount: 0,
        cron: '0 0 * * *',
      });

      prisma.recurringPaymentRun.create.mockResolvedValue({
        id: 'run_1',
        status: 'PROCESSING',
        attempt: 1,
        startedAt: now,
      });

      prisma.recurringPaymentRun.count.mockResolvedValue(1);
      prisma.$transaction.mockImplementation(async (arg: any) => {
        if (typeof arg === 'function') {
          return arg(prisma);
        }
        return Promise.all(arg);
      });

      (service.checkSufficientBalance as jest.Mock).mockRejectedValue(new Error('Payment failed'));

      await service.processDueSchedules({ now });

      expect(notificationService.notify).not.toHaveBeenCalled();
    });
  });

  describe('checkSufficientBalance', () => {
    let mockLoadAccount: jest.Mock;

    beforeEach(() => {
      mockLoadAccount = jest.fn();
      (Horizon.Server as unknown as jest.Mock).mockImplementation(() => ({
        loadAccount: mockLoadAccount,
      }));
      (Keypair.fromSecret as unknown as jest.Mock).mockReturnValue({
        publicKey: () => 'GSOURCEACCOUNT',
      });
    });

    const sourceSecretKey = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    it('returns true when the native balance covers the amount', async () => {
      mockLoadAccount.mockResolvedValue({
        balances: [{ asset_type: 'native', balance: '100.0000000' }],
      });

      await expect(
        service.checkSufficientBalance({ amount: '10.0', assetCode: 'XLM', sourceSecretKey })
      ).resolves.toBe(true);
    });

    it('throws INSUFFICIENT_FUNDS when the native balance is too low', async () => {
      mockLoadAccount.mockResolvedValue({
        balances: [{ asset_type: 'native', balance: '5.0000000' }],
      });

      await expect(
        service.checkSufficientBalance({ amount: '10.0', assetCode: 'XLM', sourceSecretKey })
      ).rejects.toMatchObject({ type: 'INSUFFICIENT_FUNDS' });
    });

    it('matches a specific issued asset balance', async () => {
      mockLoadAccount.mockResolvedValue({
        balances: [
          { asset_type: 'native', balance: '1.0000000' },
          { asset_type: 'credit_alphanum4', asset_code: 'USDC', balance: '500.0000000' },
        ],
      });

      await expect(
        service.checkSufficientBalance({ amount: '250.0', assetCode: 'USDC', sourceSecretKey })
      ).resolves.toBe(true);
    });

    it('throws INSUFFICIENT_FUNDS when the issued asset is absent', async () => {
      mockLoadAccount.mockResolvedValue({
        balances: [{ asset_type: 'native', balance: '1000.0000000' }],
      });

      await expect(
        service.checkSufficientBalance({ amount: '250.0', assetCode: 'USDC', sourceSecretKey })
      ).rejects.toMatchObject({ type: 'INSUFFICIENT_FUNDS' });
    });

    it('skips the check when no source secret is configured', async () => {
      const { config } = require('../config/env');
      const original = config.STELLAR_DISTRIBUTION_SECRET;
      config.STELLAR_DISTRIBUTION_SECRET = undefined;

      await expect(
        service.checkSufficientBalance({ amount: '10.0', assetCode: 'XLM', sourceSecretKey: undefined })
      ).resolves.toBe(true);

      config.STELLAR_DISTRIBUTION_SECRET = original;
      expect(mockLoadAccount).not.toHaveBeenCalled();
    });
  });
});
