import type { AgentTool, PageEnvelope } from '@rozenite/agent-bridge';
import type { ChannelSummary } from './filters';
import type { TimelineEventWithPayload } from './payload';
import { TIMELINE_LEVELS, type TimelineLevel } from './types';

/** Filters shared by `list-events` and `wait-for-event`. */
export type TimelineEventFilterArgs = {
  channel?: string | string[];
  name?: string | string[];
  level?: TimelineLevel | TimelineLevel[];
  search?: string;
  /** Only events logged after this sequence number (exclusive). */
  afterSeq?: number;
};

export type TimelineListEventsArgs = TimelineEventFilterArgs & {
  /** ms since the epoch; only events at or after this time. */
  since?: number;
  limit?: number;
  cursor?: string;
  /** @default 'desc' (newest first) */
  order?: 'asc' | 'desc';
};

export type TimelineListEventsResult = {
  items: TimelineEventWithPayload[];
  page: PageEnvelope;
  /** Seq of the most recent event logged; pass it as `afterSeq` later to see only what came after. */
  latestSeq: number;
};

export type TimelineWaitForEventArgs = TimelineEventFilterArgs & {
  /** @default 10000, at most 25000 */
  timeoutMs?: number;
};

export type TimelineWaitForEventResult = {
  /** The first matching event, or null when the wait timed out. */
  event: TimelineEventWithPayload | null;
  timedOut: boolean;
  latestSeq: number;
};

export type TimelineGetEventArgs = { id: string };
export type TimelineGetEventResult = { event: TimelineEventWithPayload };

export type TimelineListChannelsArgs = Record<string, never>;
export type TimelineListChannelsResult = { channels: ChannelSummary[]; totalEvents: number };

export type TimelineClearArgs = Record<string, never>;
export type TimelineClearResult = { cleared: number };

const stringOrStringArray = (description: string, items: Record<string, unknown> = {}) => ({
  description,
  anyOf: [
    { type: 'string', ...items },
    { type: 'array', items: { type: 'string', ...items } },
  ],
});

const filterProperties = {
  channel: stringOrStringArray('Only events on this channel (or any of these channels).'),
  name: stringOrStringArray('Only events with exactly this name (or any of these names), e.g. "EVENT" or "PAYMENT_FAILED".'),
  level: stringOrStringArray('Only events at this level (or any of these levels).', {
    enum: [...TIMELINE_LEVELS],
  }),
  search: {
    type: 'string',
    description: 'Case-insensitive substring matched against name, preview, channel, tags and payload JSON.',
  },
  afterSeq: {
    type: 'number',
    description:
      'Only events logged after this sequence number (exclusive). Use the `latestSeq` returned by an earlier call to see only what happened since then. Prefer it over `since`: it does not depend on the device clock.',
  },
} as const;

export const timelineToolDefinitions = {
  listEvents: {
    name: 'list-events',
    description:
      'List events from the app timeline: analytics calls, feature-flag evaluations, auth transitions, payments and other domain events the app records with `timeline.log`. Newest first by default; payloads are omitted unless the `payload` field is requested (or use get-event for one full event). Every result includes `latestSeq`. To check what an action in the app produced: call list-events with limit 1 and note `latestSeq`, trigger the action, then call list-events with `afterSeq` set to that value (or use wait-for-event).',
    readOnly: true,
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {
        ...filterProperties,
        since: {
          type: 'number',
          description:
            'Only events with timestamp >= since (milliseconds since the Unix epoch, by the device clock). Prefer `afterSeq`.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of events to return. Defaults to 50, at most 500.',
        },
        cursor: {
          type: 'string',
          description: 'Opaque pagination cursor from a previous list-events call.',
        },
        order: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'desc (default) returns the newest events first; asc the oldest first.',
        },
      },
    },
    pagination: {
      kind: 'cursor',
      fields: [
        'id',
        'seq',
        'timestamp',
        'channel',
        'name',
        'preview',
        'level',
        'important',
        'tags',
        'truncated',
        'payload',
      ] as const,
      defaultFields: ['id', 'seq', 'timestamp', 'channel', 'name', 'preview', 'level', 'important'] as const,
    },
  },
  waitForEvent: {
    name: 'wait-for-event',
    description:
      'Wait until the app logs an event matching the filters, then return it with its payload. Use it to verify that an action in the app (a tap, a navigation, a request) produced the expected event, without polling. Without `afterSeq` it waits only for events logged after the call starts; with `afterSeq` it first returns an already-logged match after that seq. Returns `timedOut: true` and a null event if nothing matched within `timeoutMs`.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        ...filterProperties,
        timeoutMs: {
          type: 'number',
          description: 'How long to wait, in milliseconds. Defaults to 10000, at most 25000.',
        },
      },
    },
  },
  getEvent: {
    name: 'get-event',
    description:
      'Read one timeline event by id (from list-events or wait-for-event), including its full payload as JSON.',
    readOnly: true,
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Event id, as returned by list-events.' },
      },
      required: ['id'],
    },
  },
  listChannels: {
    name: 'list-channels',
    description:
      'List the channels seen in the buffered timeline, with event counts and the time of the latest event on each.',
    readOnly: true,
    idempotent: true,
    inputSchema: { type: 'object', properties: {} },
  },
  clear: {
    name: 'clear',
    description:
      'Delete every buffered timeline event in the app and in an open DevTools panel. Returns how many events were removed.',
    destructive: true,
    idempotent: true,
    inputSchema: { type: 'object', properties: {} },
  },
} satisfies Record<string, AgentTool>;
