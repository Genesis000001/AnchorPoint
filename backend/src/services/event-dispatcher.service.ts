import { Response } from 'express';
import { randomUUID } from 'crypto';
import logger from '../utils/logger';

/** Interval at which each SSE connection receives a keep-alive comment. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

/** Optional filters a subscriber can register to receive a subset of events. */
export interface EventFilter {
  eventType?: string;
  contractId?: string;
}

interface SseClient {
  id: string;
  res: Response;
  filters: EventFilter;
  heartbeat: NodeJS.Timeout;
}

/**
 * Manages Server-Sent Events (SSE) subscribers and broadcasts contract
 * events to them. Each subscriber may register filters (event type and/or
 * contract id) so they only receive matching events. Connections are kept
 * alive with periodic `: ping` comment frames.
 */
export class EventDispatcherService {
  private clients = new Map<string, SseClient>();

  /**
   * Register a new SSE subscriber.
   *
   * @param res     The HTTP response to write events to.
   * @param filters Optional filters restricting which events are delivered.
   * @returns An unsubscribe function that removes the client and stops its
   *          heartbeat. Safe to call more than once.
   */
  public subscribe(res: Response, filters: EventFilter = {}): () => void {
    const id = randomUUID();
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        this.clients.delete(id);
      }
    }, DEFAULT_HEARTBEAT_INTERVAL_MS);

    this.clients.set(id, { id, res, filters, heartbeat });
    logger.debug(`SSE client subscribed (${this.clients.size} total)`, { id });

    return () => {
      clearInterval(heartbeat);
      if (this.clients.delete(id)) {
        logger.debug(`SSE client unsubscribed (${this.clients.size} total)`, { id });
      }
    };
  }

  /**
   * Broadcast an event to every subscribed client whose filters match.
   *
   * @param event The event payload to serialize as an SSE `data` frame.
   * @returns The number of clients the event was delivered to.
   */
  public broadcast(event: unknown): number {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    let delivered = 0;

    for (const [id, client] of this.clients) {
      if (!this.matches(client.filters, event)) {
        continue;
      }
      try {
        client.res.write(payload);
        delivered++;
      } catch {
        // The client socket is no longer writable; drop it so it stops
        // receiving frames.
        this.clients.delete(id);
      }
    }

    return delivered;
  }

  /**
   * Send a keep-alive comment to every connected client.
   */
  public heartbeat(): void {
    for (const client of this.clients.values()) {
      try {
        client.res.write(': ping\n\n');
      } catch {
        this.clients.delete(client.id);
      }
    }
  }

  /**
   * Number of currently subscribed SSE clients.
   */
  public getSubscriberCount(): number {
    return this.clients.size;
  }

  private matches(filters: EventFilter, event: unknown): boolean {
    const record = (event ?? {}) as Record<string, unknown>;

    if (filters.eventType) {
      const eventType = record.eventType ?? record.type;
      if (eventType !== filters.eventType) {
        return false;
      }
    }

    if (filters.contractId && record.contractId !== filters.contractId) {
      return false;
    }

    return true;
  }
}

export const eventDispatcher = new EventDispatcherService();
