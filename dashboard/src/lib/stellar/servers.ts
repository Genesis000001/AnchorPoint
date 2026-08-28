import { Horizon, rpc } from '@stellar/stellar-sdk';
import type { NetworkEndpoints } from './networks';

export interface StellarServers {
  horizon: Horizon.Server;
  soroban: rpc.Server;
  endpoints: NetworkEndpoints;
}

export type StellarServerFactory = (endpoints: NetworkEndpoints) => StellarServers;

/**
 * Builds a fresh SDK server pair bound to one network.
 *
 * Servers hold their base URL at construction time, so a network switch has to
 * discard the previous pair and build a new one rather than mutate it.
 */
export const createStellarServers: StellarServerFactory = (endpoints) => ({
  horizon: new Horizon.Server(endpoints.horizonUrl, {
    // Futurenet and local networks are reached over plain HTTP in some setups.
    allowHttp: endpoints.horizonUrl.startsWith('http://'),
  }),
  soroban: new rpc.Server(endpoints.sorobanRpcUrl, {
    allowHttp: endpoints.sorobanRpcUrl.startsWith('http://'),
  }),
  endpoints,
});
