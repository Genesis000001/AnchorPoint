import React, { useMemo, useState } from 'react';
import { Play, TerminalSquare, Sparkles } from 'lucide-react';
import { Contract, scValToNative, xdr } from '@stellar/stellar-sdk';

interface ContractPlaygroundProps {
  apiBaseUrl?: string;
}

const defaultArgs = '{"name":"AnchorPoint"}';
const defaultContractId = 'CB64D3...';

const parseArguments = (raw: string) => {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
};

const encodeValue = (value: unknown): xdr.ScVal => {
  if (typeof value === 'string') {
    return xdr.ScVal.scvString(value);
  }
  if (typeof value === 'number') {
    return xdr.ScVal.scvI64(new xdr.Int64(BigInt(value)));
  }
  if (typeof value === 'boolean') {
    return xdr.ScVal.scvBool(value);
  }
  if (Array.isArray(value)) {
    return xdr.ScVal.scvVec(value.map((item) => encodeValue(item)));
  }
  if (value && typeof value === 'object') {
    return xdr.ScVal.scvMap(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: encodeValue(child) })),
    );
  }
  return xdr.ScVal.scvVoid();
};

export const ContractPlayground: React.FC<ContractPlaygroundProps> = ({ apiBaseUrl = 'http://localhost:3002' }) => {
  const [contractId, setContractId] = useState(defaultContractId);
  const [functionName, setFunctionName] = useState('get_name');
  const [argumentsInput, setArgumentsInput] = useState(defaultArgs);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const parsedArgs = useMemo(() => parseArguments(argumentsInput), [argumentsInput]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setError('');
    setResult('');

    try {
      const response = await fetch(`${apiBaseUrl}/api/config`);
      if (!response.ok) {
        throw new Error('Unable to reach backend config endpoint');
      }

      const rpcUrl = 'https://soroban-testnet.stellar.org';
      const server = new (await import('@stellar/stellar-sdk')).rpc.Server(rpcUrl);
      const contract = new Contract(contractId);
      const tx = new (await import('@stellar/stellar-sdk')).TransactionBuilder(
        new (await import('@stellar/stellar-sdk')).Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0'),
        {
          fee: '100',
          networkPassphrase: 'Test SDF Network ; September 2015',
        },
      )
        .addOperation(contract.call(functionName, ...parsedArgs.map((arg) => encodeValue(arg))))
        .setTimeout(30)
        .build();

      const simulated = await server.simulateTransaction(tx);
      const retval = 'result' in simulated ? simulated.result?.retval : undefined;
      if (!retval) {
        throw new Error('The contract returned no value.');
      }
      setResult(JSON.stringify(scValToNative(retval), null, 2));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to simulate contract call';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Sparkles size={16} className="text-primary-text" />
          Soroban contract playground
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Try a read-only simulation against a Soroban contract and inspect the decoded return value.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="glass-card space-y-4 p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm text-slate-300">
            <span className="font-medium">Contract ID</span>
            <input
              value={contractId}
              onChange={(event) => setContractId(event.target.value)}
              className="input-field w-full"
              placeholder="CD..."
            />
          </label>

          <label className="space-y-2 text-sm text-slate-300">
            <span className="font-medium">Function name</span>
            <input
              value={functionName}
              onChange={(event) => setFunctionName(event.target.value)}
              className="input-field w-full"
              placeholder="get_name"
            />
          </label>
        </div>

        <label className="block space-y-2 text-sm text-slate-300">
          <span className="font-medium">Arguments (JSON array)</span>
          <textarea
            value={argumentsInput}
            onChange={(event) => setArgumentsInput(event.target.value)}
            rows={6}
            className="input-field min-h-32 w-full font-mono text-sm"
            placeholder={'["AnchorPoint"]'}
          />
        </label>

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Play size={16} />
          {isLoading ? 'Simulating…' : 'Simulate call'}
        </button>
      </form>

      <div className="glass-card p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <TerminalSquare size={16} className="text-primary-text" />
          Result
        </div>
        {error ? (
          <p className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>
        ) : result ? (
          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950/80 p-4 text-sm text-slate-200">{result}</pre>
        ) : (
          <p className="mt-3 text-sm text-slate-400">Run a simulation to inspect the decoded return value.</p>
        )}
      </div>
    </div>
  );
};

export default ContractPlayground;
