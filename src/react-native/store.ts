import { serializeToJson, type SerializeOptions } from '../shared/serialize';
import {
  isTimelineLevel,
  type TimelineEvent,
  type TimelineEventInput,
} from '../shared/types';
import { reportInternalError } from './report';
import { RingBuffer } from './ring-buffer';

export const DEFAULT_MAX_EVENTS = 1000;
const MAX_PREVIEW_LENGTH = 1000;
/** A replay chunk is closed once it holds this many events… */
const DEFAULT_CHUNK_EVENTS = 100;
/** …or this much payload JSON, whichever comes first. */
const DEFAULT_CHUNK_BYTES = 256 * 1024;

/** One piece of a (possibly multi-message) replay of the buffer. */
export type TimelineSnapshotChunk = {
  /** Identifies the buffer's contents; changes on app restart and on clear. */
  sessionKey: string;
  maxEvents: number;
  /** First chunk of a full replay: the panel drops what it had. */
  reset: boolean;
  events: TimelineEvent[];
  /** Last chunk: from here on, events are streamed as they are logged. */
  done: boolean;
};

/** Receives events while a panel is listening. */
export type TimelineSink = {
  onSnapshot: (chunk: TimelineSnapshotChunk) => void;
  onEvents: (events: TimelineEvent[]) => void;
  onCleared: () => void;
};

/** Where a reconnecting panel left off, so only newer events are replayed. */
export type TimelineResumePoint = {
  sessionKey?: string;
  afterSeq?: number;
};

export type TimelineStoreOptions = {
  maxEvents?: number;
  serializeOptions?: SerializeOptions;
  now?: () => number;
  chunkEvents?: number;
  chunkBytes?: number;
  /** Injection seam for tests. */
  serialize?: typeof serializeToJson;
  /** Injection seam for tests: how replay yields between chunks. */
  schedule?: (callback: () => void) => void;
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
 * While a panel is attached and live, `log()` serializes the event and hands
 * it to the sink synchronously — like the Redux DevTools plugin, there is no
 * batching timer between the call and the bridge. Otherwise (no panel, a
 * paused panel, or a replay still in progress) `log()` only pushes onto the
 * ring buffer; the payload is kept by reference and serialized when (and if)
 * something asks for it.
 *
 * Attaching replays the buffer in chunks, yielding to the app between them,
 * so opening the panel on a full buffer never blocks the JS thread for long.
 * A panel that knows where it left off gets only the newer events.
 */
export const createTimelineStore = (options: TimelineStoreOptions = {}) => {
  const now = options.now ?? Date.now;
  const serializeOptions = options.serializeOptions;
  const serialize = options.serialize ?? serializeToJson;
  const chunkEvents = options.chunkEvents ?? DEFAULT_CHUNK_EVENTS;
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  const schedule = options.schedule ?? ((callback: () => void) => setTimeout(callback, 0));
  const sessionPrefix = createSessionPrefix();

  const buffer = new RingBuffer<Entry>(options.maxEvents ?? DEFAULT_MAX_EVENTS);
  let seq = 0;
  let generation = 0;
  let sink: TimelineSink | null = null;
  /** True once the replay has caught up and events stream as logged. */
  let live = false;
  /** Identifies the replay in progress; a new attach or a detach cancels it. */
  let replayToken: object | null = null;
  /** Observers of new events (an agent waiting for one); usually empty. */
  const listeners = new Set<(event: TimelineEvent) => void>();

  const sessionKey = () => `${sessionPrefix}:${generation}`;

  const detach = (sinkToRemove?: TimelineSink) => {
    if (sinkToRemove !== undefined && sinkToRemove !== sink) {
      return;
    }
    sink = null;
    live = false;
    replayToken = null;
  };

  /** Calls into the bridge; a failure detaches instead of reaching the app. */
  const deliver = (target: TimelineSink, send: () => void): boolean => {
    try {
      send();
      return true;
    } catch (error) {
      detach(target);
      reportInternalError(error);
      return false;
    }
  };

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

    if (listeners.size > 0) {
      const logged = materialize(entry);
      listeners.forEach((listener) => {
        try {
          listener(logged);
        } catch (error) {
          reportInternalError(error);
        }
      });
    }

    if (live && sink !== null) {
      const target = sink;
      deliver(target, () => target.onEvents([materialize(entry)]));
    }
  };

  const replay = (target: TimelineSink, token: object, afterSeq: number, reset: boolean) => {
    if (replayToken !== token) {
      return;
    }
    const pending = buffer.toArray().filter((entry) => entry.event.seq > afterSeq);
    const events: TimelineEvent[] = [];
    let bytes = 0;
    for (const entry of pending) {
      if (events.length >= chunkEvents || bytes >= chunkBytes) {
        break;
      }
      const event = materialize(entry);
      bytes += event.payloadJson?.length ?? 0;
      events.push(event);
    }
    const done = events.length === pending.length;
    if (done) {
      // Go live before sending, in the same tick: nothing logged after this
      // point can fall between the last chunk and the stream.
      live = true;
      replayToken = null;
    }
    const chunk: TimelineSnapshotChunk = {
      sessionKey: sessionKey(),
      maxEvents: buffer.capacity,
      reset,
      events,
      done,
    };
    if (!deliver(target, () => target.onSnapshot(chunk)) || done) {
      return;
    }
    // Events logged while we yield have higher seqs: a later chunk picks them up.
    const nextAfter = events[events.length - 1].seq;
    schedule(() => replay(target, token, nextAfter, false));
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
      // Any resume point a panel holds is now meaningless.
      generation += 1;
      if (sink !== null) {
        const target = sink;
        deliver(target, () => target.onCleared());
      }
      return cleared;
    },

    /**
     * Starts (or restarts) streaming to `nextSink`: replays the buffer in
     * chunks through `onSnapshot`, then streams new events through `onEvents`.
     * With a resume point from the same session and no events lost to
     * eviction since, only the newer events are replayed.
     */
    attach: (nextSink: TimelineSink, from: TimelineResumePoint = {}) => {
      sink = nextSink;
      live = false;
      const token = {};
      replayToken = token;

      const oldest = buffer.toArray()[0]?.event.seq;
      const canResume =
        from.sessionKey === sessionKey() &&
        typeof from.afterSeq === 'number' &&
        (oldest === undefined || oldest <= from.afterSeq + 1);

      replay(nextSink, token, canResume ? (from.afterSeq as number) : 0, !canResume);
    },

    detach,

    /**
     * Calls `listener` with every event logged from now on, serialized.
     * Costs nothing while no one is listening. Returns an unsubscribe.
     */
    onLogged: (listener: (event: TimelineEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Seq of the most recent event ever logged (0 if none), even if evicted or cleared. */
    get latestSeq() {
      return seq;
    },

    get isAttached() {
      return sink !== null;
    },

    /** Attached and past the replay: `log()` sends synchronously. */
    get isLive() {
      return live;
    },
  };
};
