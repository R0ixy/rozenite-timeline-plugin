import type { TimelineEvent } from './types';

/**
 * Must equal the `name` in package.json: the Rozenite dev host and DevTools
 * address messages by package name, and a mismatch silently drops them.
 */
export const TIMELINE_PLUGIN_ID = 'rozenite-timeline-plugin';

/**
 * Protocol between the app (device) and the panel.
 *
 * The panel drives the session: it says `hello` when it mounts (or when the
 * device announces itself with `device-ready`), and the device answers with a
 * full `snapshot` of its ring buffer. From then on the device streams new
 * events in `events` batches until the panel says `bye`. Replaying the whole
 * buffer on every `hello` is what makes panel reloads and app reloads
 * self-healing.
 */
export type TimelineEventMap = {
  // device -> panel
  'device-ready': { maxEvents: number };
  snapshot: { events: TimelineEvent[]; maxEvents: number };
  events: { events: TimelineEvent[] };
  cleared: Record<string, never>;

  // panel -> device
  hello: Record<string, never>;
  bye: Record<string, never>;
  clear: Record<string, never>;
};
