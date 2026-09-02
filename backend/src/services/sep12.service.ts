import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { KYCStatus } from '@prisma/client';
import { kycProvider, KycStatus, type KycSubmissionInput } from './kyc-provider.service';
import {
  defaultWebhookService,
  WebhookService,
  type KycWebhookRecord,
  type WebhookDeliveryResult,
} from './webhook.service';

export interface UpdateCustomerKycStatusInput {
  customerId: string;
  nextStatus: KYCStatus;
  rejectionReasons?: string[] | string;
  provider?: string;
  providerRef?: string;
  webhookService?: WebhookService;
}

export interface HandleKycStatusTransitionInput {
  customer: KycWebhookRecord;
  nextStatus: string | KYCStatus;
  rejectionReasons?: string[] | string;
  webhookService?: WebhookService;
}

export class Sep12Service {
  private readonly webhookService: WebhookService;

  constructor(webhookService: WebhookService = defaultWebhookService) {
    this.webhookService = webhookService;
  }

  public toDbStatus(status: KycStatus | string): KYCStatus {
    const normalized = String(status).toUpperCase();
    switch (normalized) {
      case 'ACCEPTED':
      case 'APPROVED':
        return KYCStatus.ACCEPTED;
      case 'REJECTED':
      case 'DECLINED':
        return KYCStatus.REJECTED;
      case 'KYC_EXPIRING_SOON':
        return KYCStatus.KYC_EXPIRING_SOON;
      default:
        return KYCStatus.PENDING;
    }
  }

  public toSep12Status(status: KycStatus | KYCStatus | string): string {
    const normalized = String(status).toUpperCase();
    switch (normalized) {
      case 'ACCEPTED':
      case 'APPROVED':
        return 'ACCEPTED';
      case 'REJECTED':
      case 'DECLINED':
        return 'REJECTED';
      case 'KYC_EXPIRING_SOON':
        return 'PENDING';
      default:
        return 'PROCESSING';
    }
  }

  /**
   * Updates customer KYC status in the database and triggers the `customer.kyc_status_updated`
   * partner webhook event if a state transition occurred.
   */
  async updateCustomerKycStatus({
    customerId,
    nextStatus,
    rejectionReasons,
    provider,
    providerRef,
    webhookService = this.webhookService,
  }: UpdateCustomerKycStatusInput): Promise<{
    customer: KycWebhookRecord;
    webhookDelivery: WebhookDeliveryResult;
  }> {
    const existingCustomer = await prisma.kycCustomer.findUnique({
      where: { id: customerId },
      include: {
        user: {
          select: {
            publicKey: true,
          },
        },
      },
    });

    if (!existingCustomer) {
      throw new Error(`KycCustomer ${customerId} not found`);
    }

    const previousStatus = existingCustomer.status;

    if (previousStatus === nextStatus) {
      return {
        customer: existingCustomer as unknown as KycWebhookRecord,
        webhookDelivery: {
          delivered: false,
          attempts: 0,
          skipped: true,
        },
      };
    }

    const updatedCustomer = await prisma.kycCustomer.update({
      where: { id: customerId },
      data: {
        status: nextStatus,
        ...(provider ? { provider } : {}),
        ...(providerRef ? { providerRef } : {}),
      },
      include: {
        user: {
          select: {
            publicKey: true,
          },
        },
      },
    });

    const reasons =
      rejectionReasons ??
      (nextStatus === KYCStatus.REJECTED ? ['VERIFICATION_FAILED'] : undefined);

    let webhookDelivery: WebhookDeliveryResult;
    try {
      webhookDelivery = await webhookService.sendKycStatusChanged(
        updatedCustomer as unknown as KycWebhookRecord,
        previousStatus,
        reasons
      );
    } catch (error) {
      logger.error('SEP-12 KYC status updated but webhook delivery threw', {
        customerId,
        error: error instanceof Error ? error.message : String(error),
      });
      webhookDelivery = {
        delivered: false,
        attempts: 1,
        error: error instanceof Error ? error.message : 'Unknown webhook error',
      };
    }

    return {
      customer: updatedCustomer as unknown as KycWebhookRecord,
      webhookDelivery,
    };
  }

  /**
   * Notifies partner endpoints of customer KYC status updates with rejection reasons.
   */
  async notifyKycStatusTransition({
    customer,
    nextStatus,
    rejectionReasons,
    webhookService = this.webhookService,
  }: HandleKycStatusTransitionInput): Promise<WebhookDeliveryResult> {
    const nextStatusStr = String(nextStatus);
    if (customer.status === nextStatusStr) {
      return {
        delivered: false,
        attempts: 0,
        skipped: true,
      };
    }

    const updatedRecord: KycWebhookRecord = {
      ...customer,
      status: nextStatusStr,
      rejectionReasons,
    };

    return webhookService.sendKycStatusChanged(
      updatedRecord,
      customer.status,
      rejectionReasons
    );
  }
}

export const sep12Service = new Sep12Service();
export default sep12Service;
