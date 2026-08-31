import { KYCStatus } from '@prisma/client';
import { Sep12Service, type UpdateCustomerKycStatusInput } from './sep12.service';
import type { KycWebhookRecord, WebhookService } from './webhook.service';

const prismaMock = {
  kycCustomer: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: prismaMock,
}));

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Sep12Service', () => {
  let webhookServiceMock: {
    sendKycStatusChanged: jest.Mock;
  };
  let sep12Service: Sep12Service;

  beforeEach(() => {
    jest.clearAllMocks();
    webhookServiceMock = {
      sendKycStatusChanged: jest.fn().mockResolvedValue({
        delivered: true,
        attempts: 1,
        statusCode: 200,
        responseBody: 'ok',
      }),
    };
    sep12Service = new Sep12Service(webhookServiceMock as unknown as WebhookService);
  });

  describe('updateCustomerKycStatus', () => {
    it('dispatches customer.kyc_status_updated webhook when state transitions from PENDING to ACCEPTED', async () => {
      const existingCustomer = {
        id: 'cust-123',
        userId: 'user-123',
        status: KYCStatus.PENDING,
        createdAt: new Date('2026-03-30T10:00:00.000Z'),
        updatedAt: new Date('2026-03-30T10:00:00.000Z'),
        user: { publicKey: 'GBCUST123' },
      };

      const updatedCustomer = {
        ...existingCustomer,
        status: KYCStatus.ACCEPTED,
        provider: 'persona',
        providerRef: 'inq_123',
        updatedAt: new Date('2026-03-30T10:05:00.000Z'),
      };

      prismaMock.kycCustomer.findUnique.mockResolvedValue(existingCustomer);
      prismaMock.kycCustomer.update.mockResolvedValue(updatedCustomer);

      const result = await sep12Service.updateCustomerKycStatus({
        customerId: 'cust-123',
        nextStatus: KYCStatus.ACCEPTED,
        provider: 'persona',
        providerRef: 'inq_123',
      });

      expect(prismaMock.kycCustomer.findUnique).toHaveBeenCalledWith({
        where: { id: 'cust-123' },
        include: { user: { select: { publicKey: true } } },
      });

      expect(prismaMock.kycCustomer.update).toHaveBeenCalledWith({
        where: { id: 'cust-123' },
        data: {
          status: KYCStatus.ACCEPTED,
          provider: 'persona',
          providerRef: 'inq_123',
        },
        include: { user: { select: { publicKey: true } } },
      });

      expect(webhookServiceMock.sendKycStatusChanged).toHaveBeenCalledWith(
        updatedCustomer,
        KYCStatus.PENDING,
        undefined
      );

      expect(result.customer).toEqual(updatedCustomer);
      expect(result.webhookDelivery.delivered).toBe(true);
    });

    it('includes rejection reason codes in webhook dispatch when status transitions to REJECTED', async () => {
      const existingCustomer = {
        id: 'cust-456',
        userId: 'user-456',
        status: KYCStatus.PENDING,
        createdAt: new Date('2026-03-30T10:00:00.000Z'),
        updatedAt: new Date('2026-03-30T10:00:00.000Z'),
        user: { publicKey: 'GBCUST456' },
      };

      const updatedCustomer = {
        ...existingCustomer,
        status: KYCStatus.REJECTED,
        provider: 'shufti',
        providerRef: 'ref_456',
        updatedAt: new Date('2026-03-30T10:05:00.000Z'),
      };

      prismaMock.kycCustomer.findUnique.mockResolvedValue(existingCustomer);
      prismaMock.kycCustomer.update.mockResolvedValue(updatedCustomer);

      const rejectionReasons = ['DOCUMENT_UNREADABLE', 'FACE_MISMATCH'];

      const result = await sep12Service.updateCustomerKycStatus({
        customerId: 'cust-456',
        nextStatus: KYCStatus.REJECTED,
        rejectionReasons,
        provider: 'shufti',
        providerRef: 'ref_456',
      });

      expect(webhookServiceMock.sendKycStatusChanged).toHaveBeenCalledWith(
        updatedCustomer,
        KYCStatus.PENDING,
        rejectionReasons
      );

      expect(result.customer.status).toBe(KYCStatus.REJECTED);
      expect(result.webhookDelivery.delivered).toBe(true);
    });

    it('skips webhook delivery when customer status is unchanged', async () => {
      const existingCustomer = {
        id: 'cust-789',
        userId: 'user-789',
        status: KYCStatus.ACCEPTED,
        createdAt: new Date('2026-03-30T10:00:00.000Z'),
        updatedAt: new Date('2026-03-30T10:00:00.000Z'),
        user: { publicKey: 'GBCUST789' },
      };

      prismaMock.kycCustomer.findUnique.mockResolvedValue(existingCustomer);

      const result = await sep12Service.updateCustomerKycStatus({
        customerId: 'cust-789',
        nextStatus: KYCStatus.ACCEPTED,
      });

      expect(prismaMock.kycCustomer.update).not.toHaveBeenCalled();
      expect(webhookServiceMock.sendKycStatusChanged).not.toHaveBeenCalled();
      expect(result.webhookDelivery.skipped).toBe(true);
      expect(result.webhookDelivery.delivered).toBe(false);
    });

    it('handles webhook delivery errors without throwing', async () => {
      const existingCustomer = {
        id: 'cust-err',
        userId: 'user-err',
        status: KYCStatus.PENDING,
        createdAt: new Date('2026-03-30T10:00:00.000Z'),
        updatedAt: new Date('2026-03-30T10:00:00.000Z'),
        user: { publicKey: 'GBERR' },
      };

      const updatedCustomer = {
        ...existingCustomer,
        status: KYCStatus.ACCEPTED,
      };

      prismaMock.kycCustomer.findUnique.mockResolvedValue(existingCustomer);
      prismaMock.kycCustomer.update.mockResolvedValue(updatedCustomer);
      webhookServiceMock.sendKycStatusChanged.mockRejectedValue(new Error('Network failure'));

      const result = await sep12Service.updateCustomerKycStatus({
        customerId: 'cust-err',
        nextStatus: KYCStatus.ACCEPTED,
      });

      expect(result.customer.status).toBe(KYCStatus.ACCEPTED);
      expect(result.webhookDelivery.delivered).toBe(false);
      expect(result.webhookDelivery.error).toBe('Network failure');
    });
  });

  describe('notifyKycStatusTransition', () => {
    it('notifies status transition with rejection reasons', async () => {
      const customer: KycWebhookRecord = {
        id: 'cust-notify',
        userId: 'user-notify',
        status: 'PENDING',
        createdAt: new Date('2026-03-30T10:00:00.000Z'),
        updatedAt: new Date('2026-03-30T10:00:00.000Z'),
        user: { publicKey: 'GBNOTIFY' },
      };

      const result = await sep12Service.notifyKycStatusTransition({
        customer,
        nextStatus: 'REJECTED',
        rejectionReasons: ['SANCTIONS_LISTED'],
      });

      expect(webhookServiceMock.sendKycStatusChanged).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'cust-notify',
          status: 'REJECTED',
          rejectionReasons: ['SANCTIONS_LISTED'],
        }),
        'PENDING',
        ['SANCTIONS_LISTED']
      );
      expect(result.delivered).toBe(true);
    });

    it('returns skipped when status is unchanged', async () => {
      const customer: KycWebhookRecord = {
        id: 'cust-notify-same',
        userId: 'user-notify',
        status: 'ACCEPTED',
        createdAt: new Date('2026-03-30T10:00:00.000Z'),
        updatedAt: new Date('2026-03-30T10:00:00.000Z'),
      };

      const result = await sep12Service.notifyKycStatusTransition({
        customer,
        nextStatus: 'ACCEPTED',
      });

      expect(webhookServiceMock.sendKycStatusChanged).not.toHaveBeenCalled();
      expect(result.skipped).toBe(true);
    });
  });
});
