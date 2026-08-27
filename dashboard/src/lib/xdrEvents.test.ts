import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  decodeContractEvent,
  decodeContractEventEnvelope,
  decodeScVal,
  eventName,
  jsonReplacer,
  toDecodedJson,
} from './xdrEvents';

const ACCOUNT = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const b64 = (value: xdr.ScVal) => value.toXDR('base64');

/** Builds a base64 ContractEvent envelope the way the stream delivers one. */
const envelope = (topics: xdr.ScVal[], data: xdr.ScVal, contractIdByte = 7) =>
  new xdr.ContractEvent({
    ext: new xdr.ExtensionPoint(0),
    // The SDK declares byte fields as `Opaque[]` (its own "workaround" alias) while producing and consuming Buffers at runtime
    contractId: Buffer.alloc(32, contractIdByte) as any,
    type: xdr.ContractEventType.contract(),
    body: new xdr.ContractEventBody(0, new xdr.ContractEventV0({ topics, data })),
  }).toXDR('base64');

describe('decodeScVal', () => {
  it('decodes a Symbol topic to its string', () => {
    const result = decodeScVal(b64(xdr.ScVal.scvSymbol('transfer')));

    expect(result.value).toBe('transfer');
    expect(result.type).toBe('scvSymbol');
    expect(result.error).toBeUndefined();
  });

  it('decodes an Address topic to a strkey', () => {
    const result = decodeScVal(b64(new Address(ACCOUNT).toScVal()));

    expect(result.value).toBe(ACCOUNT);
    expect(result.type).toBe('scvAddress');
  });

  it('decodes a u128 to a bigint rather than a lossy number', () => {
    const big = 340282366920938463463374607431768211455n;
    const result = decodeScVal(b64(nativeToScVal(big, { type: 'u128' })));

    expect(result.value).toBe(big);
    expect(result.type).toBe('scvU128');
  });

  it('decodes a map payload into a plain object', () => {
    const result = decodeScVal(
      b64(nativeToScVal({ amount: 42, memo: 'thanks' }, { type: { amount: ['symbol', 'u32'] } })),
    );

    expect(result.value).toMatchObject({ amount: 42, memo: 'thanks' });
  });

  it('reports an error instead of throwing on malformed XDR', () => {
    const result = decodeScVal('not-valid-xdr!!');

    expect(result.value).toBeNull();
    expect(typeof result.error).toBe('string');
  });

  it('reports an error for an empty value', () => {
    expect(decodeScVal('').error).toBe('Empty XDR value');
  });
});

describe('decodeContractEvent', () => {
  it('decodes every topic and the data payload', () => {
    const decoded = decodeContractEvent({
      topics: [
        b64(xdr.ScVal.scvSymbol('transfer')),
        b64(new Address(ACCOUNT).toScVal()),
      ],
      data: b64(nativeToScVal(1234567890n, { type: 'u128' })),
      contractId: 'CONTRACT_A',
    });

    expect(decoded.topics.map((t) => t.value)).toEqual(['transfer', ACCOUNT]);
    expect(decoded.data.value).toBe(1234567890n);
    expect(decoded.contractId).toBe('CONTRACT_A');
  });

  it('keeps decoding the remaining topics when one is malformed', () => {
    const decoded = decodeContractEvent({
      topics: ['garbage', b64(xdr.ScVal.scvSymbol('mint'))],
    });

    expect(decoded.topics[0].error).toBeTruthy();
    expect(decoded.topics[1].value).toBe('mint');
  });

  it('tolerates a missing topics field', () => {
    expect(decodeContractEvent({}).topics).toEqual([]);
  });
});

describe('decodeContractEventEnvelope', () => {
  it('decodes topics, data and the contract id from an envelope', () => {
    const decoded = decodeContractEventEnvelope(
      envelope([xdr.ScVal.scvSymbol('transfer')], nativeToScVal(42, { type: 'u32' })),
    );

    expect(decoded.topics[0].value).toBe('transfer');
    expect(decoded.data.value).toBe(42);
    expect(decoded.contractId?.startsWith('C')).toBe(true);
  });

  it('reports an error rather than throwing on a malformed envelope', () => {
    const decoded = decodeContractEventEnvelope('////not-an-envelope');

    expect(decoded.topics).toEqual([]);
    expect(typeof decoded.data.error).toBe('string');
  });
});

describe('toDecodedJson', () => {
  it('serialises bigints as decimal strings so precision survives', () => {
    const json = toDecodedJson({ amount: 340282366920938463463374607431768211455n });

    expect(json).toContain('"340282366920938463463374607431768211455"');
  });

  it('serialises byte arrays as hex', () => {
    expect(jsonReplacer('k', new Uint8Array([0, 15, 255]))).toBe('000fff');
  });

  it('produces indented output for the copy action', () => {
    expect(toDecodedJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe('eventName', () => {
  it('uses the first topic as the event name', () => {
    const decoded = decodeContractEvent({ topics: [b64(xdr.ScVal.scvSymbol('swap'))] });

    expect(eventName(decoded)).toBe('swap');
  });

  it('falls back to unknown when no topic decoded', () => {
    expect(eventName({ topics: [], data: { value: null, type: null } })).toBe('unknown');
  });
});
