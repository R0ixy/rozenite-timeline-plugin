import type { TimelineChannelEventInput, TimelineEventInput } from '../shared/types';
import { createTimelineStore, type TimelineStore } from './store';

export type TimelineChannelLogger = {
  readonly channel: string;
  log: (input: TimelineChannelEventInput) => void;
};

export type Timeline = {
  /** Records an event. Never throws. */
  log: (input: TimelineEventInput) => void;
  /** Returns a logger bound to one channel. */
  channel: (name: string) => TimelineChannelLogger;
  /** Drops every buffered event, in the app and in an open panel. */
  clear: () => void;
};

const GLOBAL_KEY = '__ROZENITE_TIMELINE_STORE__';

/**
 * One store per JS runtime. Kept on `globalThis` so it survives Fast Refresh
 * re-evaluating this module, and so duplicate copies of the package in one
 * bundle still share a single timeline.
 */
export const getTimelineStore = (): TimelineStore => {
  const host = globalThis as typeof globalThis & { [GLOBAL_KEY]?: TimelineStore };
  let store = host[GLOBAL_KEY];
  if (!store) {
    store = createTimelineStore();
    host[GLOBAL_KEY] = store;
  }
  return store;
};

let warned = false;

const reportInternalError = (error: unknown) => {
  // A timeline bug must never become an app bug: report once and move on.
  if (warned) {
    return;
  }
  warned = true;
  try {
    console.warn('[rozenite-timeline-plugin] Internal error, event dropped.', error);
  } catch {
    // Nothing left to do.
  }
};

const log = (input: TimelineEventInput) => {
  try {
    getTimelineStore().log(input);
  } catch (error) {
    reportInternalError(error);
  }
};

const channel = (name: string): TimelineChannelLogger => {
  const boundChannel = typeof name === 'string' && name ? name : 'default';
  return {
    channel: boundChannel,
    log: (input) => {
      try {
        log({ ...(input as TimelineChannelEventInput), channel: boundChannel });
      } catch (error) {
        reportInternalError(error);
      }
    },
  };
};

const clear = () => {
  try {
    getTimelineStore().clear();
  } catch (error) {
    reportInternalError(error);
  }
};

export const timeline: Timeline = { log, channel, clear };
