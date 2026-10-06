import { safeSerialize, type SerializeOptions } from '../shared/serialize';
import {
  isTimelineLevel,
  type TimelineEvent,
  type TimelineEventInput,
} from '../shared/types';
import { RingBuffer } from './ring-buffer';

export const DEFAULT_MAX_EVENTS = 1000;
const DEFAULT_BATCH_INTERVAL_MS = 50;
const DEFAULT_MAX_BATCH_SIZE = 250;
const MAX_PREVIEW_LENGTH = 1000;

/** Receives events while a panel is listening. */
export type TimelineSink = {
  onEvents: (events: TimelineEvent[]) => void;
  onCleared: () => void;
};

export type TimelineStoreOptions = {
  maxEvents?: number;
  /** How long to wait for more events before sending a batch. */
  batchIntervalMs?: number;
  /** A batch this large is sent right away. */
  maxBatchSize?: number;
  serializeOptions?: SerializeOptions;
  now?: () => number;
  /** Injection seam for tests. */
  serialize?: typeof safeSerialize;
};

type Entry = {
  /** Everything but the payload, captured at log time. */
  event: TimelineEvent;
  /** The payload exactly as logged. Serialized lazily, at most once. */
  raw: unknown;
  hasPayload: boolean;
  serialized: boolean;
};

export type TimelineStore = ReturnType<typeof createTimelineStore>;

const createSessionPrefix = (): string =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0')}`;

const normalizeTags = (tags: unknown): string[] => {
  if (!Array.isArray(tags)) {
    return [];
  }
  const result: string[] = [];
  for (const tag of tags) {
    if (typeof tag === 'string') {
      result.push(tag);
    } else if (typeof tag === 'number' || typeof tag === 'boolean') {
      result.push(String(tag));
    }
  }
  return result;
};

const normalizePreview = (preview: unknown): string | undefined => {
  if (preview === undefined || preview === null) {
    return undefined;
  }
  const text = typeof preview === 'string' ? preview : String(preview);
  return text.length > MAX_PREVIEW_LENGTH ? `${text.slice(0, MAX_PREVIEW_LENGTH)}…` : text;
};

/**
 * The device-side event buffer. While no panel is attached, `log()` only
 * builds a small metadata object and pushes it onto the ring buffer; the
 * payload is kept by reference and serialized when (and if) something asks
 * for it — a panel connecting, or an agent tool call.
 */
export const createTimelineStore = (options: TimelineStoreOptions = {}) => {
  const batchIntervalMs = options.batchIntervalMs ?? DEFAULT_BATCH_INTERVAL_MS;
  const maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
  const now = options.now ?? Date.now;
  const serializeOptions = options.serializeOptions;
  const serialize = options.serialize ?? safeSerialize;
  const sessionPrefix = createSessionPrefix();

  const buffer = new RingBuffer<Entry>(options.maxEvents ?? DEFAULT_MAX_EVENTS);
  let seq = 0;
  let sink: TimelineSink | null = null;
  let pending: Entry[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const materialize = (entry: Entry): TimelineEvent => {
    if (!entry.serialized) {
      entry.serialized = true;
      if (entry.hasPayload) {
        const { value, truncated } = serialize(entry.raw, serializeOptions);
        entry.event.payload = value;
        if (truncated) {
          entry.event.truncated = true;
        }
      }
      // Drop the reference so the original object can be garbage collected.
      entry.raw = undefined;
    }
    return entry.event;
  };

  const cancelFlush = () => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  };

  const flush = () => {
    cancelFlush();
    if (pending.length === 0 || sink === null) {
      pending = [];
      return;
    }
    const batch = pending;
    pending = [];
    sink.onEvents(batch.map(materialize));
  };

  const log = (input: TimelineEventInput) => {
    const source = (input ?? {}) as Partial<TimelineEventInput>;
    seq += 1;

    const event: TimelineEvent = {
      id: `${sessionPrefix}-${seq}`,
      seq,
      timestamp: now(),
      channel: typeof source.channel === 'string' && source.channel ? source.channel : 'default',
      name: typeof source.name === 'string' && source.name ? source.name : 'EVENT',
      level: isTimelineLevel(source.level) ? source.level : 'info',
      important: source.important === true,
      tags: normalizeTags(source.tags),
    };
    const preview = normalizePreview(source.preview);
    if (preview !== undefined) {
      event.preview = preview;
    }

    const entry: Entry = {
      event,
      raw: source.payload,
      hasPayload: source.payload !== undefined,
      serialized: false,
    };
    buffer.push(entry);

    if (sink === null) {
      return;
    }

    pending.push(entry);
    if (pending.length >= maxBatchSize) {
      flush();
    } else if (flushTimer === null) {
      flushTimer = setTimeout(flush, batchIntervalMs);
    }
  };

  return {
    log,
    flush,

    /** Every buffered event, oldest first, with payloads serialized. */
    getEvents: (): TimelineEvent[] => buffer.toArray().map(materialize),

    getEvent: (id: string): TimelineEvent | undefined => {
      const entry = buffer.toArray().find((candidate) => candidate.event.id === id);
      return entry ? materialize(entry) : undefined;
    },

    get size() {
      return buffer.size;
    },

    get maxEvents() {
      return buffer.capacity;
    },

    setMaxEvents: (maxEvents: number) => {
      buffer.resize(maxEvents);
    },

    /** Empties the buffer and tells an attached panel to do the same. */
    clear: (): number => {
      const cleared = buffer.size;
      buffer.clear();
      pending = [];
      cancelFlush();
      sink?.onCleared();
      return cleared;
    },

    /**
     * Starts streaming to `nextSink`. Returns the current buffer, so the
     * caller can send it as the initial snapshot; anything logged afterwards
     * reaches the sink in batches.
     */
    attach: (nextSink: TimelineSink): TimelineEvent[] => {
      cancelFlush();
      pending = [];
      sink = nextSink;
      return buffer.toArray().map(materialize);
    },

    detach: (sinkToRemove?: TimelineSink) => {
      if (sinkToRemove !== undefined && sinkToRemove !== sink) {
        return;
      }
      sink = null;
      pending = [];
      cancelFlush();
    },

    get isAttached() {
      return sink !== null;
    },
  };
};
