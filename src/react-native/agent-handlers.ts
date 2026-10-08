import type {
  TimelineClearResult,
  TimelineGetEventResult,
  TimelineListChannelsResult,
  TimelineListEventsArgs,
  TimelineListEventsResult,
} from '../shared/agent-tools';
import { createEventPredicate, summarizeChannels } from '../shared/filters';
import { withParsedPayload } from '../shared/payload';
import { isTimelineLevel, type TimelineEvent } from '../shared/types';
import type { TimelineStore } from './store';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const toArray = <T>(value: T | T[] | undefined): T[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

const normalizeLimit = (limit: unknown): number => {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_LIMIT);
};

// Cursors point at a sequence number rather than an index, so a page stays
// correct while new events arrive and old ones are evicted between calls.
const encodeCursor = (order: 'asc' | 'desc', seq: number) => `${order}:${seq}`;

const decodeCursor = (cursor: string, order: 'asc' | 'desc'): number => {
  const [cursorOrder, rawSeq] = cursor.split(':', 2);
  const seq = Number(rawSeq);
  if (cursorOrder !== order || !Number.isInteger(seq)) {
    throw new Error(
      `Invalid cursor "${cursor}". Pass a cursor from a previous list-events call with the same order.`,
    );
  }
  return seq;
};

/**
 * Agent tool handler bodies, kept apart from the React hook so they can be
 * tested against a real store.
 */
export const createTimelineAgentHandlers = (getStore: () => TimelineStore) => ({
  listEvents: (args: TimelineListEventsArgs = {}): TimelineListEventsResult => {
    const order = args.order === 'asc' ? 'asc' : 'desc';
    const limit = normalizeLimit(args.limit);
    const levels = toArray(args.level)?.filter(isTimelineLevel);
    const predicate = createEventPredicate({
      channels: toArray(args.channel),
      levels,
      search: args.search,
      since: typeof args.since === 'number' ? args.since : undefined,
    });

    const boundary = args.cursor ? decodeCursor(args.cursor, order) : undefined;
    const all = getStore().getEvents();
    const ordered = order === 'desc' ? all.reverse() : all;

    const items: TimelineEvent[] = [];
    let hasMore = false;
    for (const event of ordered) {
      if (boundary !== undefined && (order === 'desc' ? event.seq >= boundary : event.seq <= boundary)) {
        continue;
      }
      if (!predicate(event)) {
        continue;
      }
      if (items.length === limit) {
        hasMore = true;
        break;
      }
      items.push(event);
    }

    const last = items[items.length - 1];
    return {
      items: items.map(withParsedPayload),
      page: {
        limit,
        hasMore,
        ...(hasMore && last ? { nextCursor: encodeCursor(order, last.seq) } : {}),
      },
    };
  },

  getEvent: ({ id }: { id: string }): TimelineGetEventResult => {
    const event = getStore().getEvent(id);
    if (!event) {
      throw new Error(`Timeline event "${id}" not found. It may have been evicted or cleared.`);
    }
    return { event: withParsedPayload(event) };
  },

  listChannels: (): TimelineListChannelsResult => {
    const events = getStore().getEvents();
    return { channels: summarizeChannels(events), totalEvents: events.length };
  },

  clear: (): TimelineClearResult => ({ cleared: getStore().clear() }),
});
