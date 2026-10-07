import type { AgentTool, PageEnvelope } from '@rozenite/agent-bridge';
import type { ChannelSummary } from './filters';
import { TIMELINE_LEVELS, type TimelineEvent, type TimelineLevel } from './types';

export type TimelineListEventsArgs = {
  channel?: string | string[];
  level?: TimelineLevel | TimelineLevel[];
  search?: string;
  /** ms since the epoch; only events at or after this time. */
  since?: number;
  limit?: number;
  cursor?: string;
  /** @default 'desc' (newest first) */
  order?: 'asc' | 'desc';
};

export type TimelineListEventsResult = {
  items: TimelineEvent[];
  page: PageEnvelope;
};

export type TimelineGetEventArgs = { id: string };
export type TimelineGetEventResult = { event: TimelineEvent };

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

export const timelineToolDefinitions = {
  listEvents: {
    name: 'list-events',
    description:
      'List events from the app timeline (analytics calls, feature-flag evaluations, auth transitions and other domain logs the app records with `timeline.log`). Newest first by default. Payloads are omitted unless requested through fields; use get-event for a single full event.',
    readOnly: true,
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {
        channel: stringOrStringArray('Only events on this channel (or any of these channels).'),
        level: stringOrStringArray('Only events at this level (or any of these levels).', {
          enum: [...TIMELINE_LEVELS],
        }),
        search: {
          type: 'string',
          description: 'Case-insensitive substring matched against name, preview, tags and payload.',
        },
        since: {
          type: 'number',
          description: 'Only events with timestamp >= since (milliseconds since the Unix epoch).',
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
      ],
      defaultFields: ['id', 'timestamp', 'channel', 'name', 'preview', 'level', 'important'],
    },
  },
  getEvent: {
    name: 'get-event',
    description: 'Read one timeline event by id, including its serialized payload.',
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
