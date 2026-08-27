import {
  buildSep24StatusWebhookPayload,
  notifySep24StatusChange,
} from './sep24CallbackNotifier';
import { InMemoryWebhookDeliveryStore } from './idempotentWebhook.service';

describe('sep24CallbackNotifier', () => {
  const baseInput = {
    transactionId: 'tx-sep24-1',
    kind: 'deposit' as const,
    previousStatus: 'pending_user',
    nextStatus: 'completed',
    callbackUrl: 'https://partner.example/sep24',
    amount: '10.00',
    assetCode: 'USDC',
  };

  it('builds a sep24.transaction.status_changed payload', () => {
    const payload = buildSep24StatusWebhookPayload(baseInput);
    expect(payload.event).toBe('sep24.transaction.status_changed');
    expect(payload.previousStatus).toBe('pending_user');
    expect(payload.transaction).toEqual(
      expect.objectContaining({
        id: 'tx-sep24-1',
        kind: 'deposit',
        status: 'completed',
        amount: '10.00',
        asset_code: 'USDC',
      })
    );
  });

  it('sends Idempotency-Key header on successful delivery', async () => {
    const httpClient = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ok',
    });
    const deliveryStore = new InMemoryWebhookDeliveryStore();
    const enqueueRetry = jest.fn();

    const result = await notifySep24StatusChange(baseInput, {
      httpClient,
      deliveryStore,
      enqueueRetry,
    });

    expect(result.delivered).toBe(true);
    expect(result.idempotencyKey).toBe('sep24:tx-sep24-1:pending_user->completed');
    expect(httpClient).toHaveBeenCalledTimes(1);
    const [, request] = httpClient.mock.calls[0];
    expect(request.headers['Idempotency-Key']).toBe(result.idempotencyKey);
    expect(request.headers['x-anchorpoint-event']).toBe('sep24.transaction.status_changed');
    expect(enqueueRetry).not.toHaveBeenCalled();
  });

  it('skips duplicate emissions for identical status transitions', async () => {
    const httpClient = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ok',
    });
    const deliveryStore = new InMemoryWebhookDeliveryStore();

    await notifySep24StatusChange(baseInput, { httpClient, deliveryStore, enqueueRetry: jest.fn() });
    const second = await notifySep24StatusChange(baseInput, {
      httpClient,
      deliveryStore,
      enqueueRetry: jest.fn(),
    });

    expect(second.skipped).toBe(true);
    expect(second.delivered).toBe(false);
    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  it('skips when previous and next status are identical', async () => {
    const httpClient = jest.fn();
    const result = await notifySep24StatusChange(
      { ...baseInput, previousStatus: 'completed', nextStatus: 'completed' },
      { httpClient, deliveryStore: new InMemoryWebhookDeliveryStore(), enqueueRetry: jest.fn() }
    );
    expect(result.skipped).toBe(true);
    expect(httpClient).not.toHaveBeenCalled();
  });

  it('enqueues retry queue on delivery failure', async () => {
    const httpClient = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'unavailable',
    });
    const enqueueRetry = jest.fn().mockResolvedValue('job-1');
    const deliveryStore = new InMemoryWebhookDeliveryStore();

    const result = await notifySep24StatusChange(baseInput, {
      httpClient,
      deliveryStore,
      enqueueRetry,
    });

    expect(result.delivered).toBe(false);
    expect(enqueueRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'sep24',
        transactionId: 'tx-sep24-1',
        idempotencyKey: 'sep24:tx-sep24-1:pending_user->completed',
        callbackUrl: baseInput.callbackUrl,
      })
    );
  });

  it('enqueues retry queue on network error', async () => {
    const httpClient = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const enqueueRetry = jest.fn().mockResolvedValue('job-2');

    const result = await notifySep24StatusChange(baseInput, {
      httpClient,
      deliveryStore: new InMemoryWebhookDeliveryStore(),
      enqueueRetry,
    });

    expect(result.delivered).toBe(false);
    expect(result.error).toContain('ECONNRESET');
    expect(enqueueRetry).toHaveBeenCalledTimes(1);
  });

  it('builds a sep24.transaction.claimable payload when claimableBalanceId is provided', () => {
    const payload = buildSep24StatusWebhookPayload({
      ...baseInput,
      nextStatus: 'pending_external',
      claimableBalanceId: '00000000abc123',
    });
    expect(payload.event).toBe('sep24.transaction.claimable');
    expect(payload.transaction.status).toBe('pending_external');
    expect(payload.transaction.claimable_balance_id).toBe('00000000abc123');
  });

  it('sends x-anchorpoint-event header as sep24.transaction.claimable for claimable balance event', async () => {
    const httpClient = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ok',
    });
    const deliveryStore = new InMemoryWebhookDeliveryStore();

    const result = await notifySep24StatusChange(
      {
        ...baseInput,
        nextStatus: 'pending_external',
        claimableBalanceId: '00000000abc123',
        event: 'sep24.transaction.claimable',
      },
      { httpClient, deliveryStore, enqueueRetry: jest.fn() }
    );

    expect(result.delivered).toBe(true);
    const [, request] = httpClient.mock.calls[0];
    expect(request.headers['x-anchorpoint-event']).toBe('sep24.transaction.claimable');
    const parsedBody = JSON.parse(request.body);
    expect(parsedBody.event).toBe('sep24.transaction.claimable');
    expect(parsedBody.transaction.claimable_balance_id).toBe('00000000abc123');
  });
});
