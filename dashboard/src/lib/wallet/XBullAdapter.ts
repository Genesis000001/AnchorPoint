import { WalletAdapter } from './types';

type XBullApi = {
  isConnected(): Promise<boolean>;
  getPublicKey(): Promise<string>;
  getNetwork(): Promise<string>;
  signTransaction(xdr: string, network: string): Promise<string>;
};

declare global {
  interface Window {
    xBull?: XBullApi;
  }
}

export class XBullAdapter implements WalletAdapter {
  id = 'xbull';
  name = 'xBull';
  icon = 'xbull-icon-url';

  async isInstalled(): Promise<boolean> {
    // Check if the xBull extension is injected
    return typeof window !== 'undefined' && !!window.xBull;
  }

  async connect(): Promise<{ publicKey: string; network: string }> {
    const installed = await this.isInstalled();
    if (!installed) {
      throw new Error('xBull is not installed');
    }
    
    const api = window.xBull;
    if (!api) {
      throw new Error('xBull is not installed');
    }

    try {
      if (await api.isConnected()) {
        const publicKey = await api.getPublicKey();
        const network = await api.getNetwork();
        return { publicKey, network };
      } else {
        throw new Error('User cancelled connection');
      }
    } catch (error) {
      throw new Error(`Failed to connect to xBull: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    // xBull doesn't have a direct disconnect, but we can do local cleanup
    return Promise.resolve();
  }

  async signTransaction(xdr: string, network: string): Promise<string> {
    const installed = await this.isInstalled();
    if (!installed) {
      throw new Error('xBull is not installed');
    }

    const api = window.xBull;
    if (!api) {
      throw new Error('xBull is not installed');
    }

    try {
      const signedXdr = await api.signTransaction(xdr, network);
      return signedXdr;
    } catch (error) {
      throw new Error(`Failed to sign transaction: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
