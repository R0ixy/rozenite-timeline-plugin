export const TIMELINE_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type TimelineLevel = (typeof TIMELINE_LEVELS)[number];

/** What callers pass to `timeline.log()`. */
export type TimelineEventInput = {
  /** Groups and filters events, e.g. 'analytics', 'flags', 'auth'. */
  channel: string;
  /** Short type label, e.g. EVENT | SCREEN | IDENTIFY. */
  name: string;
  /** One-line summary shown in the list. */
  preview?: string;
  /** Any value. Serialized defensively before it leaves the app. */
  payload?: unknown;
  /** @default 'info' */
  level?: TimelineLevel;
  /** Highlights the row in the panel. */
  important?: boolean;
  tags?: string[];
};

/** Input for a channel-bound logger: the channel is already fixed. */
export type TimelineChannelEventInput = Omit<TimelineEventInput, 'channel'>;

/** A JSON-safe value, as produced by the serializer. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** An event as it travels to the panel and to agent tools. */
export type TimelineEvent = {
  /** Unique across app reloads within one DevTools session. */
  id: string;
  /** Monotonic sequence number, strictly increasing within one app run. */
  seq: number;
  /** Wall-clock time in ms since the epoch, captured at `log()` time. */
  timestamp: number;
  channel: string;
  name: string;
  preview?: string;
  /**
   * The payload as JSON text, serialized once in the app. Kept as a string
   * on the wire (like the Redux DevTools plugin) so the bridge and the panel
   * never copy a deep object tree; the panel parses it only when shown.
   * Absent when no payload was logged.
   */
  payloadJson?: string;
  level: TimelineLevel;
  important: boolean;
  tags: string[];
  /** True when the payload was cut down to fit the size cap. */
  truncated?: boolean;
};

export const isTimelineLevel = (value: unknown): value is TimelineLevel =>
  typeof value === 'string' && (TIMELINE_LEVELS as readonly string[]).includes(value);
