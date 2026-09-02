import { Response } from 'express';
import { EventDispatcherService, DEFAULT_HEARTBEAT_INTERVAL_MS } from './event-dispatcher.service';

const createMockResponse = () => ({
  write: jest.fn(),
});

type MockResponse = ReturnType<typeof createMockResponse>;

describe('EventDispatcherService', () => {
  let dispatcher: EventDispatcherService;

  beforeEach(() => {
    jest.useFakeTimers();
    dispatcher = new EventDispatcherService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const subscribe = (res: MockResponse, filters?: Record<string, string>) =>
    dispatcher.subscribe(res as unknown as Response, filters);

  it('broadcasts an event to a subscribed client as an SSE data frame', () => {
    const res = createMockResponse();
    subscribe(res);

    const delivered = dispatcher.broadcast({ eventType: 'swap', contractId: 'C1', ledger: 100 });

    expect(delivered).toBe(1);
    expect(res.write).toHaveBeenCalledWith(
      'data: {"eventType":"swap","contractId":"C1","ledger":100}\n\n'
    );
  });

  it('does not deliver events to clients whose event type filter does not match', () => {
    const res = createMockResponse();
    subscribe(res, { eventType: 'swap' });

    const delivered = dispatcher.broadcast({ eventType: 'deposit', contractId: 'C1' });

    expect(delivered).toBe(0);
    expect(res.write).not.toHaveBeenCalled();
  });

  it('matches event type filters against the legacy type field', () => {
    const res = createMockResponse();
    subscribe(res, { eventType: 'swap' });

    const delivered = dispatcher.broadcast({ type: 'swap', contractId: 'C1' });

    expect(delivered).toBe(1);
    expect(res.write).toHaveBeenCalled();
  });

  it('does not deliver events to clients whose contract id filter does not match', () => {
    const res = createMockResponse();
    subscribe(res, { contractId: 'C1' });

    const delivered = dispatcher.broadcast({ eventType: 'swap', contractId: 'C2' });

    expect(delivered).toBe(0);
    expect(res.write).not.toHaveBeenCalled();
  });

  it('delivers an event only to clients matching all filters', () => {
    const matchingRes = createMockResponse();
    const nonMatchingRes = createMockResponse();
    subscribe(matchingRes, { eventType: 'swap', contractId: 'C1' });
    subscribe(nonMatchingRes, { eventType: 'swap', contractId: 'C2' });

    const delivered = dispatcher.broadcast({ eventType: 'swap', contractId: 'C1' });

    expect(delivered).toBe(1);
    expect(matchingRes.write).toHaveBeenCalledTimes(1);
    expect(nonMatchingRes.write).not.toHaveBeenCalled();
  });

  it('reports the number of subscribed clients', () => {
    expect(dispatcher.getSubscriberCount()).toBe(0);

    const unsubscribe1 = subscribe(createMockResponse());
    const unsubscribe2 = subscribe(createMockResponse());

    expect(dispatcher.getSubscriberCount()).toBe(2);

    unsubscribe1();
    expect(dispatcher.getSubscriberCount()).toBe(1);

    unsubscribe2();
    expect(dispatcher.getSubscriberCount()).toBe(0);
  });

  it('stops delivering to a client after it unsubscribes', () => {
    const res = createMockResponse();
    const unsubscribe = subscribe(res);
    unsubscribe();

    const delivered = dispatcher.broadcast({ eventType: 'swap' });

    expect(delivered).toBe(0);
    expect(res.write).not.toHaveBeenCalled();
  });

  it('sends heartbeat comments to keep the connection alive', () => {
    const res = createMockResponse();
    subscribe(res);

    expect(res.write).not.toHaveBeenCalled();

    jest.advanceTimersByTime(DEFAULT_HEARTBEAT_INTERVAL_MS);

    expect(res.write).toHaveBeenCalledWith(': ping\n\n');
  });

  it('stops sending heartbeats after the client unsubscribes', () => {
    const res = createMockResponse();
    const unsubscribe = subscribe(res);
    unsubscribe();

    jest.advanceTimersByTime(DEFAULT_HEARTBEAT_INTERVAL_MS * 2);

    expect(res.write).not.toHaveBeenCalled();
  });

  it('broadcasts to all matching subscribers and returns the delivery count', () => {
    const res1 = createMockResponse();
    const res2 = createMockResponse();
    const res3 = createMockResponse();
    subscribe(res1, { eventType: 'swap' });
    subscribe(res2, { eventType: 'swap' });
    subscribe(res3, { eventType: 'deposit' });

    const delivered = dispatcher.broadcast({ eventType: 'swap', contractId: 'C1' });

    expect(delivered).toBe(2);
    expect(res1.write).toHaveBeenCalledTimes(1);
    expect(res2.write).toHaveBeenCalledTimes(1);
    expect(res3.write).not.toHaveBeenCalled();
  });

  it('exposes a manual heartbeat that pings every connected client', () => {
    const res1 = createMockResponse();
    const res2 = createMockResponse();
    subscribe(res1);
    subscribe(res2);

    dispatcher.heartbeat();

    expect(res1.write).toHaveBeenCalledWith(': ping\n\n');
    expect(res2.write).toHaveBeenCalledWith(': ping\n\n');
  });
});
