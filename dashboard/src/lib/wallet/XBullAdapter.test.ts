import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { XBullAdapter } from './XBullAdapter';

describe('XBullAdapter', () => {
  let adapter: XBullAdapter;

  beforeEach(() => {
    adapter = new XBullAdapter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct id and name', () => {
    expect(adapter.id).toBe('xbull');
    expect(adapter.name).toBe('xBull');
  });

  it('isInstalled returns false when xBull is not available', async () => {
    (global as any).window = {};
    const installed = await adapter.isInstalled();
    expect(installed).toBe(false);
  });

  it('isInstalled returns true when xBull is available', async () => {
    (global as any).window = {
      xBull: {},
    };
    const installed = await adapter.isInstalled();
    expect(installed).toBe(true);
  });

  it('connects successfully when xBull is installed', async () => {
    (global as any).window = {
      xBull: {
        isConnected: () => Promise.resolve(true),
        getPublicKey: () => Promise.resolve('GABCD1234567890'),
        getNetwork: () => Promise.resolve('PUBLIC'),
      },
    };

    const result = await adapter.connect();
    expect(result.publicKey).toBe('GABCD1234567890');
    expect(result.network).toBe('PUBLIC');
  });

  it('throws error when xBull is not installed', async () => {
    (global as any).window = {};
    await expect(adapter.connect()).rejects.toThrow('xBull is not installed');
  });

  it('signs transaction successfully', async () => {
    (global as any).window = {
      xBull: {
        signTransaction: () => Promise.resolve('SIGNED_XDR_HERE'),
      },
    };

    const result = await adapter.signTransaction('TEST_XDR', 'PUBLIC');
    expect(result).toBe('SIGNED_XDR_HERE');
  });

  it('disconnects successfully', async () => {
    await expect(adapter.disconnect()).resolves.not.toThrow();
  });
});
