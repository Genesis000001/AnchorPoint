import { WalletAdapter } from './types';

type RabetApi = {
  isConnected(): Promise<boolean>;
  getPublicKey(): Promise<string>;
  getNetwork(): Promise<string>;
  signTransaction(xdr: string, network: string): Promise<string>;
};

declare global {
  interface Window {
    rabet?: RabetApi;
  }
}

export class RabetAdapter implements WalletAdapter {
  id = 'rabet';
  name = 'Rabet';
  icon = 'rabet-icon-url';

  async isInstalled(): Promise<boolean> {
    // Check if the Rabet extension is injected
    return typeof window !== 'undefined' && !!window.rabet;
  }

  async connect(): Promise<{ publicKey: string; network: string }> {
    const installed = await this.isInstalled();
    if (!installed) {
      throw new Error('Rabet is not installed');
    }
    
    const api = window.rabet;
    if (!api) {
      throw new Error('Rabet is not installed');
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
      throw new Error(`Failed to connect to Rabet: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    // Rabet doesn't have a direct disconnect, but we can do local cleanup
    return Promise.resolve();
  }

  async signTransaction(xdr: string, network: string): Promise<string> {
    const installed = await this.isInstalled();
    if (!installed) {
      throw new Error('Rabet is not installed');
    }

    const api = window.rabet;
    if (!api) {
      throw new Error('Rabet is not installed');
    }

    try {
      const signedXdr = await api.signTransaction(xdr, network);
      return signedXdr;
    } catch (error) {
      throw new Error(`Failed to sign transaction: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
