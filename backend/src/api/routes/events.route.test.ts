import express from 'express';
import request from 'supertest';
import http from 'http';
import { AddressInfo } from 'net';

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    contractEvent: {
      findMany: jest.fn(),
    },
  })),
}));

jest.mock('../../services/event-dispatcher.service', () => ({
  __esModule: true,
  eventDispatcher: {
    subscribe: jest.fn(),
    broadcast: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { PrismaClient } from '@prisma/client';
import eventsRouter from './events.route';
import { eventDispatcher } from '../../services/event-dispatcher.service';
import logger from '../../utils/logger';

const app = express();
app.use('/api/events', eventsRouter);

const prismaClient = (PrismaClient as unknown as jest.Mock).mock.results[0].value as {
  contractEvent: { findMany: jest.Mock };
};
const findManyMock = prismaClient.contractEvent.findMany;

const sampleEvents = [
  {
    id: 'evt-1',
    contractId: 'CONTRACT_ABC',
    ledger: 200,
    ledgerClosedAt: '2026-01-15T10:00:00.000Z',
    txHash: 'tx-1',
    contractEventId: 'event-1',
    topics: '["swap"]',
    value: '{"amount":"100"}',
    type: 'swap',
    createdAt: '2026-01-15T10:00:01.000Z',
  },
  {
    id: 'evt-2',
    contractId: 'CONTRACT_DEF',
    ledger: 199,
    ledgerClosedAt: '2026-01-14T10:00:00.000Z',
    txHash: 'tx-2',
    contractEventId: 'event-2',
    topics: '["deposit"]',
    value: '{"amount":"50"}',
    type: 'deposit',
    createdAt: '2026-01-14T10:00:01.000Z',
  },
];

const subscribeMock = eventDispatcher.subscribe as jest.Mock;

describe('GET /api/events (event history)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findManyMock.mockResolvedValue(sampleEvents);
  });

  it('returns events with a default limit of 50 when no filters are provided', async () => {
    const response = await request(app).get('/api/events');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(sampleEvents);
    expect(findManyMock).toHaveBeenCalledWith({
      where: {},
      orderBy: { ledger: 'desc' },
      take: 50,
    });
  });

  it('filters events by contractId', async () => {
    const response = await request(app).get('/api/events').query({ contractId: 'CONTRACT_ABC' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(sampleEvents);
    expect(findManyMock).toHaveBeenCalledWith({
      where: { contractId: 'CONTRACT_ABC' },
      orderBy: { ledger: 'desc' },
      take: 50,
    });
  });

  it('filters events by event type', async () => {
    const response = await request(app).get('/api/events').query({ eventType: 'swap' });

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledWith({
      where: { type: 'swap' },
      orderBy: { ledger: 'desc' },
      take: 50,
    });
  });

  it('filters events by both contractId and event type', async () => {
    const response = await request(app)
      .get('/api/events')
      .query({ contractId: 'CONTRACT_ABC', eventType: 'deposit' });

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledWith({
      where: { contractId: 'CONTRACT_ABC', type: 'deposit' },
      orderBy: { ledger: 'desc' },
      take: 50,
    });
  });

  it('applies a custom limit when provided', async () => {
    const response = await request(app).get('/api/events').query({ limit: '10' });

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledWith({
      where: {},
      orderBy: { ledger: 'desc' },
      take: 10,
    });
  });

  it('filters events by start date only', async () => {
    const startDate = '2026-01-01T00:00:00.000Z';
    await request(app).get('/api/events').query({ startDate });

    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        ledgerClosedAt: { gte: new Date(startDate) },
      },
      orderBy: { ledger: 'desc' },
      take: 50,
    });
  });

  it('filters events by end date only', async () => {
    const endDate = '2026-01-31T23:59:59.999Z';
    await request(app).get('/api/events').query({ endDate });

    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        ledgerClosedAt: { lte: new Date(endDate) },
      },
      orderBy: { ledger: 'desc' },
      take: 50,
    });
  });

  it('filters events by an inclusive date range', async () => {
    const startDate = '2026-01-01T00:00:00.000Z';
    const endDate = '2026-01-31T23:59:59.999Z';
    const response = await request(app).get('/api/events').query({ startDate, endDate });

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        ledgerClosedAt: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
      orderBy: { ledger: 'desc' },
      take: 50,
    });
  });

  it('combines contract, type and date-range filters', async () => {
    const startDate = '2026-01-01T00:00:00.000Z';
    const endDate = '2026-01-31T23:59:59.999Z';
    await request(app)
      .get('/api/events')
      .query({
        contractId: 'CONTRACT_ABC',
        eventType: 'swap',
        startDate,
        endDate,
        limit: '5',
      });

    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        contractId: 'CONTRACT_ABC',
        type: 'swap',
        ledgerClosedAt: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
      orderBy: { ledger: 'desc' },
      take: 5,
    });
  });

  it('returns 500 and logs an error when the database query fails', async () => {
    findManyMock.mockRejectedValue(new Error('db down'));

    const response = await request(app).get('/api/events');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal Server Error' });
    expect(logger.error).toHaveBeenCalledWith('Error fetching events:', expect.any(Error));
  });
});

describe('GET /api/events/stream (SSE)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('establishes an SSE connection and streams messages to the client', async () => {
    subscribeMock.mockImplementation((res: express.Response) => {
      res.write('data: {"eventType":"swap","contractId":"CONTRACT_ABC"}\n\n');
      res.write('data: {"eventType":"deposit","contractId":"CONTRACT_DEF"}\n\n');
      setImmediate(() => res.end());
      return jest.fn();
    });

    const response = await request(app).get('/api/events/stream');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-cache');
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(response.text).toContain(': connected');
    expect(response.text).toContain('data: {"eventType":"swap","contractId":"CONTRACT_ABC"}');
    expect(response.text).toContain('data: {"eventType":"deposit","contractId":"CONTRACT_DEF"}');
  });

  it('subscribes without filters when no query params are provided', async () => {
    subscribeMock.mockImplementation((res: express.Response) => {
      setImmediate(() => res.end());
      return jest.fn();
    });

    await request(app).get('/api/events/stream');

    expect(subscribeMock).toHaveBeenCalledWith(expect.anything(), {});
  });

  it('passes event type and contract id filters to the dispatcher subscription', async () => {
    subscribeMock.mockImplementation((res: express.Response) => {
      setImmediate(() => res.end());
      return jest.fn();
    });

    await request(app).get('/api/events/stream?eventType=swap&contractId=CONTRACT_ABC');

    expect(subscribeMock).toHaveBeenCalledWith(expect.anything(), {
      eventType: 'swap',
      contractId: 'CONTRACT_ABC',
    });
  });

  it('passes an event type only filter to the dispatcher subscription', async () => {
    subscribeMock.mockImplementation((res: express.Response) => {
      setImmediate(() => res.end());
      return jest.fn();
    });

    await request(app).get('/api/events/stream').query({ eventType: 'deposit' });

    expect(subscribeMock).toHaveBeenCalledWith(expect.anything(), { eventType: 'deposit' });
  });

  it('unsubscribes from the dispatcher when the client disconnects', (done) => {
    const unsubscribe = jest.fn();
    subscribeMock.mockReturnValue(unsubscribe);

    const server = http.createServer(app);
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      const clientReq = http.get(
        { host: '127.0.0.1', port, path: '/api/events/stream' },
        (res) => {
          // Disconnect as soon as the initial SSE chunk arrives.
          res.once('data', () => {
            clientReq.destroy();
          });
          res.on('error', () => {});
        }
      );
      clientReq.on('error', () => {});

      setTimeout(() => {
        try {
          expect(subscribeMock).toHaveBeenCalledTimes(1);
          expect(unsubscribe).toHaveBeenCalled();
          server.close();
          done();
        } catch (error) {
          server.close();
          done(error);
        }
      }, 200);
    });
  });
});
