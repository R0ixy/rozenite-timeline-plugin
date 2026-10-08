import type { TimelineEvent } from './types';

/**
 * Must equal the `name` in package.json: the Rozenite dev host and DevTools
 * address messages by package name, and a mismatch silently drops them.
 */
export const TIMELINE_PLUGIN_ID = 'rozenite-timeline-plugin';

/**
 * How long the app keeps streaming without hearing `hello` again. A panel
 * that vanished without saying `bye` (window killed, laptop asleep) stops
 * costing the app anything once this lapses.
 */
export const TIMELINE_LEASE_MS = 30_000;
/** How often a live panel renews its lease. */
export const TIMELINE_LEASE_RENEW_MS = 10_000;

/**
 * Protocol between the app (device) and the panel.
 *
 * The panel drives the session. `hello` asks the app to stream: the app
 * replays its buffer in `snapshot` chunks (only the events after `afterSeq`
 * when the panel resumes the same session), then sends each new event in an
 * `events` message as it is logged. `bye` stops streaming — the panel sends
 * it on pause and when it goes away; the app also stops on its own if a
 * `hello` doesn't renew the lease in time. `device-ready` tells an open panel
 * that the app (re)connected or changed `maxEvents`, and the panel answers
 * with `hello`.
 */
export type TimelineEventMap = {
  // device -> panel
  'device-ready': { maxEvents: number };
  snapshot: {
    sessionKey: string;
    maxEvents: number;
    reset: boolean;
    events: TimelineEvent[];
    done: boolean;
  };
  events: { events: TimelineEvent[] };
  cleared: Record<string, never>;

  // panel -> device
  hello: { sessionKey?: string; afterSeq?: number };
  bye: Record<string, never>;
  clear: Record<string, never>;
};
