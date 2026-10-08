import type { TimelineEvent, TimelineLevel } from './types';

export type TimelineFilter = {
  /** Keep only these channels. Empty or absent means every channel. */
  channels?: readonly string[];
  /** Keep only these levels. Empty or absent means every level. */
  levels?: readonly TimelineLevel[];
  /** Case-insensitive substring over name, preview, tags and payload. */
  search?: string;
  /** Keep only events with `timestamp >= since` (ms since the epoch). */
  since?: number;
};

// Payloads already arrive as JSON text; lower-case it at most once per event
// so typing in the search box stays cheap.
const payloadTextCache = new WeakMap<TimelineEvent, string>();

const getPayloadText = (event: TimelineEvent): string => {
  let text = payloadTextCache.get(event);
  if (text === undefined) {
    text = event.payloadJson?.toLowerCase() ?? '';
    payloadTextCache.set(event, text);
  }
  return text;
};

export const matchesSearch = (event: TimelineEvent, search: string): boolean => {
  const needle = search.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return (
    event.name.toLowerCase().includes(needle) ||
    (event.preview?.toLowerCase().includes(needle) ?? false) ||
    event.channel.toLowerCase().includes(needle) ||
    event.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
    getPayloadText(event).includes(needle)
  );
};

export const createEventPredicate = (filter: TimelineFilter) => {
  const channels = filter.channels?.length ? new Set(filter.channels) : null;
  const levels = filter.levels?.length ? new Set(filter.levels) : null;
  const search = filter.search?.trim() ?? '';
  const since = filter.since;

  return (event: TimelineEvent): boolean =>
    (channels === null || channels.has(event.channel)) &&
    (levels === null || levels.has(event.level)) &&
    (since === undefined || event.timestamp >= since) &&
    (search === '' || matchesSearch(event, search));
};

export const filterEvents = (
  events: readonly TimelineEvent[],
  filter: TimelineFilter,
): TimelineEvent[] => events.filter(createEventPredicate(filter));

export type ChannelSummary = {
  channel: string;
  count: number;
  lastTimestamp: number;
};

/** Channels in first-seen order, with counts. */
export const summarizeChannels = (events: readonly TimelineEvent[]): ChannelSummary[] => {
  const byChannel = new Map<string, ChannelSummary>();
  for (const event of events) {
    const summary = byChannel.get(event.channel);
    if (summary) {
      summary.count += 1;
      summary.lastTimestamp = Math.max(summary.lastTimestamp, event.timestamp);
    } else {
      byChannel.set(event.channel, {
        channel: event.channel,
        count: 1,
        lastTimestamp: event.timestamp,
      });
    }
  }
  return Array.from(byChannel.values());
};
