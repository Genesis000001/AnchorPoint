import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventLogViewer, toLogEntry, type RawContractEvent } from './EventLogViewer';

const ACCOUNT = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const CONTRACT_A = 'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const CONTRACT_B = 'CBUAPGCC5CB5AXTGKN2A6PBLLI4EKQAKLLRJCRFH4RJHKGN2HHUZKPSC';

const b64 = (value: xdr.ScVal) => value.toXDR('base64');

const transferEvent = (contractId: string, id: string): RawContractEvent => ({
  id,
  contractId,
  timestamp: '2026-01-31T12:00:00.000Z',
  topics: [b64(xdr.ScVal.scvSymbol('transfer')), b64(new Address(ACCOUNT).toScVal())],
  data: b64(nativeToScVal(1234567890n, { type: 'u128' })),
});

describe('EventLogViewer decoding', () => {
  it('renders decoded topic symbols instead of raw XDR', () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 'e1')]} />);

    const entry = screen.getByLabelText('Event transfer');
    // Appears twice by design: once on the badge, once as topic[0].
    expect(within(entry).getAllByText('transfer').length).toBeGreaterThan(0);
    expect(within(entry).getByText(ACCOUNT)).toBeTruthy();
    // The base64 form must not leak into the log body.
    expect(entry.textContent).not.toContain('AAAADwAAAAh0cmFuc2Zlcg==');
  });

  it('labels each topic with its ScVal arm', () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 'e1')]} />);

    const entry = screen.getByLabelText('Event transfer');
    expect(within(entry).getByText('scvSymbol')).toBeTruthy();
    expect(within(entry).getByText('scvAddress')).toBeTruthy();
  });

  it('renders a u128 payload at full precision', () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 'e1')]} />);

    expect(screen.getByLabelText('Event transfer').textContent).toContain('1234567890');
  });

  it('surfaces a decode failure on the entry instead of dropping the log', () => {
    render(
      <EventLogViewer
        initialEvents={[
          { id: 'bad', contractId: CONTRACT_A, topics: ['not-xdr'], data: 'also-not-xdr' },
        ]}
      />,
    );

    const entry = screen.getByLabelText('Event unknown');
    expect(within(entry).getByText(/topic\[0\]/)).toBeTruthy();
    expect(entry.querySelector('.text-red-400')).toBeTruthy();
  });

  it('decodes a full ContractEvent envelope including its contract id', () => {
    const raw = new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      // The SDK declares byte fields as `Opaque[]` (its own "workaround" alias) while producing and consuming Buffers at runtime
    contractId: Buffer.alloc(32, 7) as any,
      type: xdr.ContractEventType.contract(),
      body: new xdr.ContractEventBody(
        0,
        new xdr.ContractEventV0({
          topics: [xdr.ScVal.scvSymbol('mint')],
          data: nativeToScVal(42, { type: 'u32' }),
        }),
      ),
    }).toXDR('base64');

    const entry = toLogEntry({ id: 'env', xdr: raw });

    expect(entry.topic).toBe('mint');
    expect(entry.decoded.data.value).toBe(42);
    expect(entry.contractId?.startsWith('C')).toBe(true);
  });
});

describe('EventLogViewer contract filter', () => {
  const events = [
    transferEvent(CONTRACT_A, 'a1'),
    { ...transferEvent(CONTRACT_B, 'b1'), topics: [b64(xdr.ScVal.scvSymbol('mint'))] },
  ];

  it('lists every contract seen in the log', () => {
    render(<EventLogViewer initialEvents={events} />);

    const select = screen.getByLabelText('Filter by contract ID') as HTMLSelectElement;
    expect(select.options.length).toBe(3); // 'All contracts' plus both ids
    expect(Array.from(select.options).map((o) => o.value)).toContain(CONTRACT_A);
    expect(Array.from(select.options).map((o) => o.value)).toContain(CONTRACT_B);
  });

  it('shows only the selected contract’s events', async () => {
    render(<EventLogViewer initialEvents={events} />);

    expect(screen.getByLabelText('Event transfer')).toBeTruthy();
    expect(screen.getByLabelText('Event mint')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter by contract ID'), {
      target: { value: CONTRACT_B },
    });

    await waitFor(() => expect(screen.queryByLabelText('Event transfer')).toBeNull());
    expect(screen.getByLabelText('Event mint')).toBeTruthy();
  });

  it('explains an empty filtered view rather than looking disconnected', async () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 'a1')]} />);

    fireEvent.change(screen.getByLabelText('Filter by contract ID'), {
      target: { value: CONTRACT_A },
    });
    fireEvent.click(screen.getByLabelText('Clear log'));

    await waitFor(() => expect(screen.getByText('Waiting for events…')).toBeTruthy());
  });
});

describe('EventLogViewer copy action', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('copies the decoded JSON, not the raw XDR', async () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 'e1')]} />);

    fireEvent.click(screen.getByLabelText('Copy decoded JSON for event transfer'));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    const parsed = JSON.parse(copied);

    expect(parsed.topics).toEqual(['transfer', ACCOUNT]);
    // bigint payloads survive as strings rather than losing precision.
    expect(parsed.data).toBe('1234567890');
    expect(parsed.contractId).toBe(CONTRACT_A);
  });

  it('confirms the copy inline', async () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 'e1')]} />);

    fireEvent.click(screen.getByLabelText('Copy decoded JSON for event transfer'));

    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
  });

  it('stays silent when the clipboard is unavailable', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 'e1')]} />);

    fireEvent.click(screen.getByLabelText('Copy decoded JSON for event transfer'));

    await waitFor(() => expect(screen.queryByText('Copied')).toBeNull());
  });
});

describe('EventLogViewer log management', () => {
  it('clears the log on request', async () => {
    render(<EventLogViewer initialEvents={[transferEvent(CONTRACT_A, 'e1')]} />);

    fireEvent.click(screen.getByLabelText('Clear log'));

    await waitFor(() => expect(screen.queryByLabelText('Event transfer')).toBeNull());
    expect(screen.getByText('Waiting for events…')).toBeTruthy();
  });

  it('reports a disconnected stream until the first open', () => {
    render(<EventLogViewer />);

    expect(screen.getByLabelText('Disconnected')).toBeTruthy();
  });
});
