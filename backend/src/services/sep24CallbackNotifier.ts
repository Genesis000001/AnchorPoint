import logger from '../utils/logger';
import {
  buildIdempotencyKey,
  buildWebhookDeliveryHash,
  defaultWebhookDeliveryStore,
  type WebhookDeliveryStore,
} from './idempotentWebhook.service';
import { enqueueWebhookRetry } from './webhookRetry.queue';

export type Sep24HttpClient = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface Sep24StatusWebhookPayload {
  event: 'sep24.transaction.status_changed' | 'sep24.transaction.claimable';
  occurredAt: string;
  previousStatus: string;
  transaction: {
    id: string;
    kind: 'deposit' | 'withdrawal';
    status: string;
    amount?: string;
    asset_code?: string;
    stellar_transaction_id?: string;
    external_transaction_id?: string;
    claimable_balance_id?: string;
  };
}

export interface Sep24CallbackNotifyInput {
  transactionId: string;
  kind: 'deposit' | 'withdrawal';
  previousStatus: string;
  nextStatus: string;
  callbackUrl: string;
  amount?: string;
  assetCode?: string;
  stellarTransactionId?: string;
  externalTransactionId?: string;
  claimableBalanceId?: string;
  event?: 'sep24.transaction.status_changed' | 'sep24.transaction.claimable';
}

export interface Sep24CallbackDeliveryResult {
  delivered: boolean;
  skipped?: boolean;
  attempts: number;
  statusCode?: number;
  error?: string;
  idempotencyKey: string;
}

export interface Sep24CallbackNotifierDependencies {
  httpClient?: Sep24HttpClient;
  deliveryStore?: WebhookDeliveryStore;
  enqueueRetry?: typeof enqueueWebhookRetry;
  timeoutMs?: number;
}

const defaultHttpClient: Sep24HttpClient = async (url, init) => {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
  };
};

export function buildSep24StatusWebhookPayload(
  input: Sep24CallbackNotifyInput
): Sep24StatusWebhookPayload {
  const event: 'sep24.transaction.status_changed' | 'sep24.transaction.claimable' =
    input.event ||
    (input.claimableBalanceId || input.nextStatus === 'pending_external'
      ? 'sep24.transaction.claimable'
      : 'sep24.transaction.status_changed');

  return {
    event,
    occurredAt: new Date().toISOString(),
    previousStatus: input.previousStatus,
    transaction: {
      id: input.transactionId,
      kind: input.kind,
      status: input.nextStatus,
      ...(input.amount ? { amount: input.amount } : {}),
      ...(input.assetCode ? { asset_code: input.assetCode } : {}),
      ...(input.stellarTransactionId
        ? { stellar_transaction_id: input.stellarTransactionId }
        : {}),
      ...(input.externalTransactionId
        ? { external_transaction_id: input.externalTransactionId }
        : {}),
      ...(input.claimableBalanceId
        ? { claimable_balance_id: input.claimableBalanceId }
        : {}),
    },
  };
}


/**
 * Delivers an idempotent SEP-24 deposit/withdrawal status webhook to the
 * partner `on_change_callback` / `callback` URL.
 */
export async function notifySep24StatusChange(
  input: Sep24CallbackNotifyInput,
  dependencies: Sep24CallbackNotifierDependencies = {}
): Promise<Sep24CallbackDeliveryResult> {
  const httpClient = dependencies.httpClient ?? defaultHttpClient;
  const deliveryStore = dependencies.deliveryStore ?? defaultWebhookDeliveryStore;
  const enqueueRetry = dependencies.enqueueRetry ?? enqueueWebhookRetry;
  const timeoutMs = dependencies.timeoutMs ?? 5000;

  const idempotencyKey = buildIdempotencyKey({
    protocol: 'sep24',
    transactionId: input.transactionId,
    previousStatus: input.previousStatus,
    nextStatus: input.nextStatus,
  });

  if (input.previousStatus === input.nextStatus) {
    return {
      delivered: false,
      skipped: true,
      attempts: 0,
      idempotencyKey,
    };
  }

  const deliveryHash = buildWebhookDeliveryHash({
    idempotencyKey,
    callbackUrl: input.callbackUrl,
  });

  if (await deliveryStore.hasBeenDelivered(deliveryHash)) {
    logger.info('Skipping duplicate SEP-24 webhook (already delivered)', {
      transactionId: input.transactionId,
      idempotencyKey,
    });
    return {
      delivered: false,
      skipped: true,
      attempts: 0,
      idempotencyKey,
    };
  }

  const payload = buildSep24StatusWebhookPayload(input);
  const body = JSON.stringify(payload);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await httpClient(input.callbackUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'x-anchorpoint-event': payload.event,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const responseBody = await response.text();

    if (!response.ok) {
      logger.warn('SEP-24 webhook returned non-2xx response', {
        transactionId: input.transactionId,
        status: response.status,
        idempotencyKey,
        responseBody,
      });
      await enqueueRetry({
        protocol: 'sep24',
        transactionId: input.transactionId,
        previousStatus: input.previousStatus,
        nextStatus: input.nextStatus,
        callbackUrl: input.callbackUrl,
        idempotencyKey,
        deliveryHash,
        payload: body,
        attempt: 1,
      });
      return {
        delivered: false,
        attempts: 1,
        statusCode: response.status,
        error: `Webhook responded with status ${response.status}`,
        idempotencyKey,
      };
    }

    await deliveryStore.markDelivered(deliveryHash);
    logger.info('SEP-24 webhook delivered', {
      transactionId: input.transactionId,
      idempotencyKey,
    });
    return {
      delivered: true,
      attempts: 1,
      statusCode: response.status,
      idempotencyKey,
    };
  } catch (err: unknown) {
    clearTimeout(timeout);
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('SEP-24 webhook delivery failed', {
      transactionId: input.transactionId,
      error: message,
      idempotencyKey,
    });
    await enqueueRetry({
      protocol: 'sep24',
      transactionId: input.transactionId,
      previousStatus: input.previousStatus,
      nextStatus: input.nextStatus,
      callbackUrl: input.callbackUrl,
      idempotencyKey,
      deliveryHash,
      payload: body,
      attempt: 1,
    });
    return {
      delivered: false,
      attempts: 1,
      error: message,
      idempotencyKey,
    };
  }
}
