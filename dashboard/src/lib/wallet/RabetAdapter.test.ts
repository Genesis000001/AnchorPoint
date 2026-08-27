import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { RabetAdapter } from './RabetAdapter';

describe('RabetAdapter', () => {
  let adapter: RabetAdapter;

  beforeEach(() => {
    adapter = new RabetAdapter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct id and name', () => {
    expect(adapter.id).toBe('rabet');
    expect(adapter.name).toBe('Rabet');
  });

  it('isInstalled returns false when Rabet is not available', async () => {
    (global as any).window = {};
    const installed = await adapter.isInstalled();
    expect(installed).toBe(false);
  });

  it('isInstalled returns true when Rabet is available', async () => {
    (global as any).window = {
      rabet: {},
    };
    const installed = await adapter.isInstalled();
    expect(installed).toBe(true);
  });

  it('connects successfully when Rabet is installed', async () => {
    (global as any).window = {
      rabet: {
        isConnected: () => Promise.resolve(true),
        getPublicKey: () => Promise.resolve('GABCD1234567890'),
        getNetwork: () => Promise.resolve('PUBLIC'),
      },
    };

    const result = await adapter.connect();
    expect(result.publicKey).toBe('GABCD1234567890');
    expect(result.network).toBe('PUBLIC');
  });

  it('throws error when Rabet is not installed', async () => {
    (global as any).window = {};
    await expect(adapter.connect()).rejects.toThrow('Rabet is not installed');
  });

  it('signs transaction successfully', async () => {
    (global as any).window = {
      rabet: {
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
