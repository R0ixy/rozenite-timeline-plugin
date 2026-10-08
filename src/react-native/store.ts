import { serializeToJson, type SerializeOptions } from '../shared/serialize';
import {
  isTimelineLevel,
  type TimelineEvent,
  type TimelineEventInput,
} from '../shared/types';
import { RingBuffer } from './ring-buffer';

export const DEFAULT_MAX_EVENTS = 1000;
const MAX_PREVIEW_LENGTH = 1000;

/** Receives events while a panel is listening. */
export type TimelineSink = {
  onEvents: (events: TimelineEvent[]) => void;
  onCleared: () => void;
};

export type TimelineStoreOptions = {
  maxEvents?: number;
  serializeOptions?: SerializeOptions;
  now?: () => number;
  /** Injection seam for tests. */
  serialize?: typeof serializeToJson;
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
 * The device-side event buffer.
 *
 * While a panel is attached, `log()` serializes the event and hands it to the
 * sink synchronously — like the Redux DevTools plugin, there is no batching
 * timer between the call and the bridge. While no panel is attached, `log()`
 * only pushes onto the ring buffer; the payload is kept by reference and
 * serialized when (and if) something asks for it — a panel connecting, or an
 * agent tool call.
 */
export const createTimelineStore = (options: TimelineStoreOptions = {}) => {
  const now = options.now ?? Date.now;
  const serializeOptions = options.serializeOptions;
  const serialize = options.serialize ?? serializeToJson;
  const sessionPrefix = createSessionPrefix();

  const buffer = new RingBuffer<Entry>(options.maxEvents ?? DEFAULT_MAX_EVENTS);
  let seq = 0;
  let sink: TimelineSink | null = null;

  const materialize = (entry: Entry): TimelineEvent => {
    if (!entry.serialized) {
      entry.serialized = true;
      if (entry.hasPayload) {
        const { json, truncated } = serialize(entry.raw, serializeOptions);
        entry.event.payloadJson = json;
        if (truncated) {
          entry.event.truncated = true;
        }
      }
      // Drop the reference so the original object can be garbage collected.
      entry.raw = undefined;
    }
    return entry.event;
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

    sink?.onEvents([materialize(entry)]);
  };

  return {
    log,

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
      sink?.onCleared();
      return cleared;
    },

    /**
     * Starts streaming to `nextSink`. Returns the current buffer, so the
     * caller can send it as the initial snapshot; anything logged afterwards
     * reaches the sink as it is logged.
     */
    attach: (nextSink: TimelineSink): TimelineEvent[] => {
      sink = nextSink;
      return buffer.toArray().map(materialize);
    },

    detach: (sinkToRemove?: TimelineSink) => {
      if (sinkToRemove !== undefined && sinkToRemove !== sink) {
        return;
      }
      sink = null;
    },

    get isAttached() {
      return sink !== null;
    },
  };
};
