// CIRCUIT BREAKER APPROACH: Option B — breaker-wrapped service proxies
// Rationale: Option B encapsulates the circuit breaker logic within a proxy class. Callers use the proxies exactly as they would the raw clients, guaranteeing safety by default, preventing accidental bypasses, and keeping business logic completely decoupled from infrastructure failure handling.

import { rpc, xdr, Transaction, FeeBumpTransaction } from '@stellar/stellar-sdk';
import { Counter } from 'prom-client';
import { createBreaker } from './circuit-breaker.factory';
import logger from '../utils/logger';
import { redis } from '../lib/redis';
import { metricsService } from '../services/metrics.service';

export class SorobanRpcUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SorobanRpcUnavailableError';
  }
}

const circuitBreakerOpenCounter = new Counter({
  name: 'soroban_rpc_circuit_breaker_open',
  help: 'Number of times the Soroban RPC circuit breaker has tripped open',
  registers: [metricsService.getRegistry()],
});

export class SorobanRpcProxy {
  private readonly breaker;

  constructor() {
    this.breaker = createBreaker(
      'soroban:simulateTransaction',
      async (rpcServer: rpc.Server, tx: Transaction | FeeBumpTransaction, cacheKey: string) => {
        const result = await rpcServer.simulateTransaction(tx);
        await this.cacheResult(cacheKey, result as { result?: { retval?: xdr.ScVal } });
        return result;
      },
      {
        // Percentage of requests that must fail before the breaker trips OPEN
        errorThresholdPercentage: 50,
        // Time in milliseconds to wait before attempting to test the service again (HALF_OPEN)
        resetTimeout: 10000,
      }
    );

    this.breaker.fallback(async (
      rpcServer: rpc.Server,
      tx: Transaction | FeeBumpTransaction,
      cacheKey: string,
      error: Error
    ) => {
      logger.warn(`[soroban:simulateTransaction] Circuit breaker triggered. Reason: ${error.message}. Attempting to return cached transaction status.`);

      const cached = await this.getCachedResult(cacheKey);
      if (cached) {
        return cached;
      }

      throw new SorobanRpcUnavailableError('Soroban RPC is currently unavailable and no cached result exists.');
    });

    this.breaker.on('open', () => {
      circuitBreakerOpenCounter.inc();
      logger.warn('[soroban:simulateTransaction] circuit breaker opened — Soroban RPC failure threshold exceeded.');
    });
  }

  public async simulateTransaction(
    rpcServer: rpc.Server,
    tx: Transaction | FeeBumpTransaction,
    cacheKey: string
  ) {
    return this.breaker.fire(rpcServer, tx, cacheKey);
  }

  private async cacheResult(cacheKey: string, result: { result?: { retval?: xdr.ScVal } }) {
    try {
      if (result?.result?.retval) {
        await redis.set(`cache:soroban:sim:${cacheKey}`, result.result.retval.toXDR('base64'), 'EX', 300);
      }
    } catch (err) {
      logger.warn(`[soroban:simulateTransaction] Failed to cache result: ${(err as Error).message}`);
    }
  }

  private async getCachedResult(cacheKey: string) {
    try {
      const cached = await redis.get(`cache:soroban:sim:${cacheKey}`);
      if (!cached) return null;
      return { result: { retval: xdr.ScVal.fromXDR(cached, 'base64') } };
    } catch (err) {
      logger.warn(`[soroban:simulateTransaction] Redis fallback failed: ${(err as Error).message}`);
      return null;
    }
  }
}

export const sorobanRpcProxy = new SorobanRpcProxy();
