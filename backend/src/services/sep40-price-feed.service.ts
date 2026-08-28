import { EventEmitter } from 'events';
import {
  Address,
  Contract,
  xdr,
  TransactionBuilder,
  Account,
  scValToNative,
} from '@stellar/stellar-sdk';
import { config } from '../config/env';
import { stellarService } from './stellar.service';
import { sorobanRpcProxy } from '../resilience/soroban.proxy';
import logger from '../utils/logger';

/**
 * SEP-40 (Price Oracle) asset reference.
 *
 * The oracle `Asset` type is a Soroban enum with two variants:
 *   - `Stellar(Address)` — a tokenized asset identified by its contract address
 *   - `Other(Symbol)`    — an off-chain asset identified by a short symbol (e.g. "USD")
 */
export type Sep40Asset =
  | { type: 'stellar'; address: string }
  | { type: 'other'; symbol: string };

/**
 * A single price observation returned by a SEP-40 oracle. `price` is expressed
 * with the oracle's `decimals()` precision; `humanPrice` is the decimal-adjusted
 * convenience value.
 */
export interface Sep40PriceData {
  asset: Sep40Asset;
  /** Raw integer price at the oracle's configured precision. */
  price: bigint;
  /** Decimal-adjusted price (price / 10^decimals). */
  humanPrice: number;
  /** Unix timestamp (seconds) of the observation, as reported on-chain. */
  timestamp: number;
  /** Wall-clock time (ms) this value was fetched by the manager. */
  fetchedAt: number;
  decimals: number;
  /** True when the observation is older than the configured max age. */
  stale: boolean;
}

export type PriceUpdateListener = (price: Sep40PriceData) => void;
export type PriceErrorListener = (error: Error, asset: Sep40Asset) => void;

interface Subscription {
  key: string;
  asset: Sep40Asset;
  intervalMs: number;
  timer?: NodeJS.Timeout;
  listeners: Set<PriceUpdateListener>;
  errorListeners: Set<PriceErrorListener>;
  lastPrice?: Sep40PriceData;
  /** Guards against overlapping polls for the same subscription. */
  polling: boolean;
}

export interface SubscribeOptions {
  intervalMs?: number;
  onUpdate?: PriceUpdateListener;
  onError?: PriceErrorListener;
  /** Trigger an immediate poll on subscribe rather than waiting a full interval. */
  immediate?: boolean;
}

export interface Sep40PriceFeedManagerOptions {
  contractId?: string;
  sourceAccount?: string;
  defaultIntervalMs?: number;
  maxPriceAgeMs?: number;
}

/**
 * Builds a stable string key for an asset so it can be used to de-duplicate
 * subscriptions and cache entries.
 */
export function assetKey(asset: Sep40Asset): string {
  return asset.type === 'stellar'
    ? `stellar:${asset.address}`
    : `other:${asset.symbol}`;
}

/**
 * Manages SEP-40 price feed subscriptions.
 *
 * Consumers subscribe to on-chain price feeds for specific assets; the manager
 * polls the configured SEP-40 oracle contract on a per-subscription interval,
 * caches the latest observation, and pushes updates to registered listeners
 * (both per-subscription callbacks and manager-level `'price'` events).
 *
 * On-chain reads are performed via read-only Soroban transaction simulation, so
 * no signing key or fees are required.
 */
export class Sep40PriceFeedManager extends EventEmitter {
  private readonly contractId: string;
  private readonly sourceAccount: string;
  private readonly defaultIntervalMs: number;
  private readonly maxPriceAgeMs: number;

  private readonly subscriptions = new Map<string, Subscription>();
  private decimalsCache?: number;
  private started = false;

  constructor(options: Sep40PriceFeedManagerOptions = {}) {
    super();
    this.contractId = options.contractId ?? config.SEP40_ORACLE_CONTRACT_ID ?? '';
    // A read-only source account is required to build the simulated transaction;
    // it is never charged and never signs. Fall back to a well-known key.
    this.sourceAccount =
      options.sourceAccount ??
      config.ANCHOR_PUBLIC_KEY ??
      'GBZXN7PIRZGNMHGA7MUUUF4GW3F55GQRQ5UKMJTDEFEKTGW4RHFDQLNZ';
    this.defaultIntervalMs = options.defaultIntervalMs ?? config.SEP40_POLL_INTERVAL_MS;
    this.maxPriceAgeMs = options.maxPriceAgeMs ?? config.SEP40_MAX_PRICE_AGE_MS;
  }

  /**
   * Starts polling for all currently-registered subscriptions. Idempotent.
   */
  start(): void {
    if (this.started) {
      return;
    }
    if (!this.contractId) {
      logger.warn(
        'SEP-40 price feed manager started without a configured oracle contract id; polls will fail until SEP40_ORACLE_CONTRACT_ID is set'
      );
    }
    this.started = true;
    for (const sub of this.subscriptions.values()) {
      this.scheduleSubscription(sub, true);
    }
    logger.info('SEP-40 price feed manager started', {
      subscriptions: this.subscriptions.size,
    });
  }

  /**
   * Stops all polling timers. Subscriptions and cached prices are retained and
   * will resume on the next `start()`.
   */
  stop(): void {
    this.started = false;
    for (const sub of this.subscriptions.values()) {
      if (sub.timer) {
        clearInterval(sub.timer);
        sub.timer = undefined;
      }
    }
    logger.info('SEP-40 price feed manager stopped');
  }

  /**
   * Subscribes to price updates for an asset. Multiple subscribers for the same
   * asset share a single poll loop. Returns an unsubscribe function that removes
   * only the caller's listeners.
   */
  subscribe(asset: Sep40Asset, options: SubscribeOptions = {}): () => void {
    const key = assetKey(asset);
    let sub = this.subscriptions.get(key);

    if (!sub) {
      sub = {
        key,
        asset,
        intervalMs: options.intervalMs ?? this.defaultIntervalMs,
        listeners: new Set(),
        errorListeners: new Set(),
        polling: false,
      };
      this.subscriptions.set(key, sub);
    } else if (options.intervalMs && options.intervalMs !== sub.intervalMs) {
      // Adopt the shortest requested interval for a shared subscription.
      sub.intervalMs = Math.min(sub.intervalMs, options.intervalMs);
      if (sub.timer) {
        this.scheduleSubscription(sub, false);
      }
    }

    if (options.onUpdate) {
      sub.listeners.add(options.onUpdate);
      // Replay the last known price to a new listener immediately.
      if (sub.lastPrice) {
        try {
          options.onUpdate(sub.lastPrice);
        } catch (err) {
          logger.error('SEP-40 subscriber onUpdate (replay) threw', {
            key,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    if (options.onError) {
      sub.errorListeners.add(options.onError);
    }

    if (this.started) {
      this.scheduleSubscription(sub, options.immediate ?? true);
    }

    return () => this.removeListeners(key, options.onUpdate, options.onError);
  }

  /**
   * Fully removes a subscription (and stops its polling) regardless of listeners.
   */
  unsubscribe(asset: Sep40Asset): void {
    const key = assetKey(asset);
    const sub = this.subscriptions.get(key);
    if (!sub) {
      return;
    }
    if (sub.timer) {
      clearInterval(sub.timer);
    }
    this.subscriptions.delete(key);
  }

  /**
   * Returns the most recently cached price for an asset, if any.
   */
  getLatestPrice(asset: Sep40Asset): Sep40PriceData | undefined {
    return this.subscriptions.get(assetKey(asset))?.lastPrice;
  }

  /**
   * Lists all active subscriptions with their current cached price.
   */
  getSubscriptions(): Array<{ asset: Sep40Asset; intervalMs: number; lastPrice?: Sep40PriceData }> {
    return Array.from(this.subscriptions.values()).map((sub) => ({
      asset: sub.asset,
      intervalMs: sub.intervalMs,
      lastPrice: sub.lastPrice,
    }));
  }

  /**
   * Forces an immediate on-chain read for an asset, updating the cache and
   * notifying listeners. Also usable ad-hoc without an active subscription.
   */
  async refresh(asset: Sep40Asset): Promise<Sep40PriceData> {
    const price = await this.fetchLastPrice(asset);
    const sub = this.subscriptions.get(assetKey(asset));
    if (sub) {
      sub.lastPrice = price;
      this.notify(sub, price);
    }
    return price;
  }

  private removeListeners(
    key: string,
    onUpdate?: PriceUpdateListener,
    onError?: PriceErrorListener
  ): void {
    const sub = this.subscriptions.get(key);
    if (!sub) {
      return;
    }
    if (onUpdate) {
      sub.listeners.delete(onUpdate);
    }
    if (onError) {
      sub.errorListeners.delete(onError);
    }
    // Tear down the poll loop once no listeners remain.
    if (sub.listeners.size === 0 && sub.errorListeners.size === 0) {
      if (sub.timer) {
        clearInterval(sub.timer);
      }
      this.subscriptions.delete(key);
    }
  }

  private scheduleSubscription(sub: Subscription, immediate: boolean): void {
    if (sub.timer) {
      clearInterval(sub.timer);
    }
    sub.timer = setInterval(() => {
      void this.poll(sub);
    }, sub.intervalMs);
    // Avoid keeping the process alive solely for price polling.
    if (typeof sub.timer.unref === 'function') {
      sub.timer.unref();
    }
    if (immediate) {
      void this.poll(sub);
    }
  }

  private async poll(sub: Subscription): Promise<void> {
    if (sub.polling) {
      return;
    }
    sub.polling = true;
    try {
      const price = await this.fetchLastPrice(sub.asset);
      const changed =
        !sub.lastPrice ||
        sub.lastPrice.price !== price.price ||
        sub.lastPrice.timestamp !== price.timestamp;
      sub.lastPrice = price;
      if (changed) {
        this.notify(sub, price);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('SEP-40 price poll failed', {
        key: sub.key,
        error: error.message,
      });
      this.notifyError(sub, error);
    } finally {
      sub.polling = false;
    }
  }

  private notify(sub: Subscription, price: Sep40PriceData): void {
    for (const listener of sub.listeners) {
      try {
        listener(price);
      } catch (err) {
        logger.error('SEP-40 subscriber onUpdate threw', {
          key: sub.key,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.emit('price', price);
  }

  private notifyError(sub: Subscription, error: Error): void {
    for (const listener of sub.errorListeners) {
      try {
        listener(error, sub.asset);
      } catch (err) {
        logger.error('SEP-40 subscriber onError threw', {
          key: sub.key,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // Only emit if there is a listener, otherwise Node throws for 'error' events.
    if (this.listenerCount('error') > 0) {
      this.emit('error', error, sub.asset);
    }
  }

  /**
   * Reads `lastprice(asset)` from the oracle via read-only simulation and
   * decorates it with decimals and staleness metadata.
   */
  async fetchLastPrice(asset: Sep40Asset): Promise<Sep40PriceData> {
    if (!this.contractId) {
      throw new Error('SEP-40 oracle contract id is not configured');
    }

    const decimals = await this.getDecimals();
    const retval = await this.simulateCall('lastprice', [this.buildAssetScVal(asset)]);

    const native = scValToNative(retval) as { price?: unknown; timestamp?: unknown } | null;
    if (!native || native.price === undefined || native.price === null) {
      throw new Error('Oracle returned no price for asset');
    }

    const price = BigInt(native.price as string | number | bigint);
    const timestamp = Number(native.timestamp ?? 0);
    const fetchedAt = Date.now();
    const ageMs = fetchedAt - timestamp * 1000;

    return {
      asset,
      price,
      humanPrice: this.toHumanPrice(price, decimals),
      timestamp,
      fetchedAt,
      decimals,
      stale: this.maxPriceAgeMs > 0 && timestamp > 0 && ageMs > this.maxPriceAgeMs,
    };
  }

  /**
   * Reads and caches the oracle's `decimals()` value.
   */
  async getDecimals(): Promise<number> {
    if (this.decimalsCache !== undefined) {
      return this.decimalsCache;
    }
    try {
      const retval = await this.simulateCall('decimals', []);
      const value = Number(scValToNative(retval));
      this.decimalsCache = Number.isFinite(value) && value >= 0 ? value : 14;
    } catch (err) {
      // SEP-40 oracles commonly use 14 decimals; fall back to that.
      logger.warn('Failed to read SEP-40 oracle decimals; defaulting to 14', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.decimalsCache = 14;
    }
    return this.decimalsCache;
  }

  private toHumanPrice(price: bigint, decimals: number): number {
    if (decimals <= 0) {
      return Number(price);
    }
    const divisor = Math.pow(10, decimals);
    return Number(price) / divisor;
  }

  /**
   * Encodes a {@link Sep40Asset} as the oracle's `Asset` enum ScVal.
   */
  private buildAssetScVal(asset: Sep40Asset): xdr.ScVal {
    if (asset.type === 'stellar') {
      return xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('Stellar'),
        Address.fromString(asset.address).toScVal(),
      ]);
    }
    return xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol('Other'),
      xdr.ScVal.scvSymbol(asset.symbol),
    ]);
  }

  /**
   * Builds and simulates a read-only contract call, returning the raw ScVal
   * result. No transaction is submitted to the network.
   */
  private async simulateCall(method: string, args: xdr.ScVal[]): Promise<xdr.ScVal> {
    const rpcServer = stellarService.getSorobanRpc();
    const contract = new Contract(this.contractId);

    const source = new Account(this.sourceAccount, '0');
    const tx = new TransactionBuilder(source, {
      fee: '100',
      networkPassphrase: stellarService.getPassphrase(),
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const cacheKey = `sep40:${method}:${args.map((a) => a.toXDR('base64')).join(',')}`;
    const simulated = (await sorobanRpcProxy.simulateTransaction(rpcServer, tx, cacheKey)) as {
      error?: string;
      result?: { retval?: xdr.ScVal };
    };

    if (simulated.error) {
      throw new Error(`SEP-40 ${method} simulation failed: ${simulated.error}`);
    }
    if (!simulated.result?.retval) {
      throw new Error(`SEP-40 ${method} returned no result`);
    }
    return simulated.result.retval;
  }
}

export const sep40PriceFeedManager = new Sep40PriceFeedManager();
export default sep40PriceFeedManager;
