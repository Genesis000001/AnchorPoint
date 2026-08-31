import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Filter, Terminal, Trash2 } from 'lucide-react';
import {
  decodeContractEvent,
  decodeContractEventEnvelope,
  eventName,
  toDecodedJson,
  type DecodedEvent,
} from '../lib/xdrEvents';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Event frame as it arrives on the stream. Topics and data are base64 XDR;
 * `xdr` carries a full ContractEvent envelope when the backend sends one.
 */
export interface RawContractEvent {
  id?: string;
  topics?: unknown;
  data?: unknown;
  contractId?: string;
  xdr?: string;
  timestamp?: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  decoded: DecodedEvent;
  /** Event name taken from the first topic. */
  topic: string;
  contractId?: string;
}

const MAX_ENTRIES = 200;

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

const TOPIC_COLORS: Record<string, string> = {
  transfer: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  mint: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  swap: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
};

const TopicBadge: React.FC<{ topic: string }> = ({ topic }) => {
  const cls = TOPIC_COLORS[topic] ?? 'bg-slate-700/40 text-slate-300 border-slate-600/40';
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {topic}
    </span>
  );
};

/** Shortens a strkey for the filter chip; the full id stays in the title. */
const shortenId = (id: string): string =>
  id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;

/** Minimal JSON syntax highlighter — colours keys, strings, numbers, literals. */
const HighlightedJson: React.FC<{ text: string }> = ({ text }) => {
  const tokens = useMemo(
    () =>
      text.split(
        /("(?:\\.|[^"\\])*"|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      ),
    [text],
  );

  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs leading-relaxed text-slate-300">
      {tokens.map((token, index) => {
        if (/^"/.test(token)) {
          const isKey = tokens[index + 1]?.trimStart().startsWith(':');
          return (
            <span key={index} className={isKey ? 'text-sky-300' : 'text-emerald-300'}>
              {token}
            </span>
          );
        }
        if (/^(true|false)$/.test(token)) {
          return (
            <span key={index} className="text-yellow-300">
              {token}
            </span>
          );
        }
        if (token === 'null') {
          return (
            <span key={index} className="text-red-400">
              {token}
            </span>
          );
        }
        if (/^-?\d/.test(token)) {
          return (
            <span key={index} className="text-purple-300">
              {token}
            </span>
          );
        }
        return <span key={index}>{token}</span>;
      })}
    </pre>
  );
};

/** Copies the decoded JSON for one entry, confirming inline for a moment. */
const CopyDecodedButton: React.FC<{ json: string; label: string }> = ({ json, label }) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
    } catch {
      // Clipboard is unavailable over http:// and in some embedded webviews.
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-700 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
      {copied ? 'Copied' : 'Copy Decoded JSON'}
    </button>
  );
};

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

let fallbackId = 0;

/** Decodes one stream frame into a renderable entry. */
export const toLogEntry = (raw: RawContractEvent): LogEntry => {
  const decoded =
    typeof raw.xdr === 'string' && raw.xdr.length > 0
      ? decodeContractEventEnvelope(raw.xdr)
      : decodeContractEvent(raw);

  // An envelope carries its own contract id; a split frame supplies one.
  const contractId = decoded.contractId ?? raw.contractId;

  return {
    id: raw.id ?? `event-${(fallbackId += 1)}`,
    timestamp: raw.timestamp ?? new Date().toISOString(),
    decoded: { ...decoded, contractId },
    topic: eventName(decoded),
    contractId,
  };
};

// ---------------------------------------------------------------------------
// EventLogViewer
// ---------------------------------------------------------------------------

interface EventLogViewerProps {
  /** Base URL for the anchor API. Connects to `{apiBaseUrl}/api/events`. */
  apiBaseUrl?: string;
  /** Maximum entries kept in memory (default: 200). */
  maxEntries?: number;
  /** Seed entries. Primarily for tests and storybook. */
  initialEvents?: RawContractEvent[];
}

/**
 * Terminal-style viewer for Soroban contract events streamed over SSE.
 *
 * Topics and payloads arrive as base64 XDR, which is unreadable in a log, so
 * each frame is decoded to native values and rendered as a JSON tree. Entries
 * can be filtered by contract id and copied as decoded JSON.
 */
export const EventLogViewer: React.FC<EventLogViewerProps> = ({
  apiBaseUrl = '',
  maxEntries = MAX_ENTRIES,
  initialEvents,
}) => {
  const [events, setEvents] = useState<LogEntry[]>(() =>
    (initialEvents ?? []).map(toLogEntry),
  );
  const [contractFilter, setContractFilter] = useState<string>('all');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // jsdom and older webviews have no EventSource; the seeded log still works.
    if (typeof EventSource === 'undefined') return undefined;

    setError(null);
    const es = new EventSource(`${apiBaseUrl}/api/events`);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (message) => {
      try {
        const parsed = JSON.parse(message.data as string) as RawContractEvent;
        setEvents((prev) => {
          const next = [...prev, toLogEntry(parsed)];
          return next.length > maxEntries ? next.slice(next.length - maxEntries) : next;
        });
      } catch {
        // Keep-alive comments and other non-JSON frames are not events.
      }
    };

    es.onerror = () => {
      setConnected(false);
      setError('Stream disconnected. Reconnecting…');
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [apiBaseUrl, maxEntries]);

  useEffect(() => {
    // Guarded: jsdom and some embedded webviews do not implement it.
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [events]);

  const contractIds = useMemo(() => {
    const ids = new Set<string>();
    events.forEach((event) => {
      if (event.contractId) ids.add(event.contractId);
    });
    return [...ids].sort();
  }, [events]);

  const filtered = useMemo(
    () =>
      contractFilter === 'all'
        ? events
        : events.filter((event) => event.contractId === contractFilter),
    [events, contractFilter],
  );

  const handleClear = useCallback(() => setEvents([]), []);

  return (
    <section
      aria-label="Contract event log"
      className="flex h-full flex-col rounded-xl border border-slate-700 bg-slate-950"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-700 bg-slate-900 px-4 py-2">
        <Terminal size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
        <span className="text-xs font-semibold text-slate-200">Event Stream</span>
        <span
          role="status"
          aria-label={connected ? 'Connected' : 'Disconnected'}
          className={`ml-1 inline-block h-2 w-2 rounded-full ${
            connected ? 'animate-pulse bg-emerald-400' : 'bg-red-500'
          }`}
        />

        <div className="ml-auto flex items-center gap-2">
          <Filter size={13} className="text-slate-400" aria-hidden="true" />
          <label htmlFor="contract-filter" className="sr-only">
            Filter by contract ID
          </label>
          <select
            id="contract-filter"
            value={contractFilter}
            onChange={(e) => setContractFilter(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All contracts</option>
            {contractIds.map((id) => (
              <option key={id} value={id} title={id}>
                {shortenId(id)}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear log"
            className="rounded-md border border-slate-700 bg-slate-800 p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        role="log"
        aria-live="polite"
        aria-label="Contract events"
        className="flex-1 overflow-y-auto p-3 font-mono"
      >
        {error && <p className="mb-2 text-xs text-red-400">{error}</p>}

        {filtered.length === 0 ? (
          <p className="text-xs text-slate-500">
            {events.length === 0
              ? 'Waiting for events…'
              : 'No events for the selected contract.'}
          </p>
        ) : (
          filtered.map((event) => {
            const json = toDecodedJson({
              contractId: event.contractId,
              topics: event.decoded.topics.map((topic) => topic.value),
              data: event.decoded.data.value,
            });

            return (
              <article
                key={event.id}
                aria-label={`Event ${event.topic}`}
                className="mb-3 rounded-lg border border-slate-800 bg-slate-900 p-3"
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <TopicBadge topic={event.topic} />
                  <time className="text-[10px] text-slate-500" dateTime={event.timestamp}>
                    {event.timestamp}
                  </time>
                  {event.contractId && (
                    <span className="text-[10px] text-slate-600" title={event.contractId}>
                      {shortenId(event.contractId)}
                    </span>
                  )}
                  <CopyDecodedButton
                    json={json}
                    label={`Copy decoded JSON for event ${event.topic}`}
                  />
                </div>

                {/* Topic arms are the readable half of an event; list them
                    before the payload so the shape is obvious at a glance. */}
                <ul className="mb-2 space-y-0.5">
                  {event.decoded.topics.map((topic, index) => (
                    <li key={index} className="flex items-baseline gap-2 text-[11px]">
                      <span className="text-slate-500">topic[{index}]</span>
                      {topic.type && <span className="text-slate-600">{topic.type}</span>}
                      <span className={topic.error ? 'text-red-400' : 'text-slate-200'}>
                        {topic.error ?? String(topic.value)}
                      </span>
                    </li>
                  ))}
                </ul>

                {event.decoded.data.error ? (
                  <p className="text-xs text-red-400">{event.decoded.data.error}</p>
                ) : (
                  <HighlightedJson text={toDecodedJson(event.decoded.data.value)} />
                )}
              </article>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  );
};

export default EventLogViewer;
