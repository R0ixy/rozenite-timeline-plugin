import { useRozeniteDevToolsClient, type RozeniteDevToolsClient } from '@rozenite/plugin-bridge';
import { useEffect, useRef } from 'react';
import { TIMELINE_LEASE_MS, TIMELINE_PLUGIN_ID, type TimelineEventMap } from '../shared/messaging';
import { reportInternalError } from './report';
import { DEFAULT_MAX_EVENTS, type TimelineSink, type TimelineStore } from './store';
import { getTimelineStore } from './timeline';
import { useTimelineAgentTools } from './useTimelineAgentTools';

export type RozeniteTimelinePluginOptions = {
  /** Ring buffer capacity. @default 1000 */
  maxEvents?: number;
};

/** Message handlers run on the app's JS thread: never let one throw there. */
const guard =
  <T>(handler: (payload: T) => void) =>
  (payload: T) => {
    try {
      handler(payload);
    } catch (error) {
      reportInternalError(error);
    }
  };

/**
 * Wires the timeline store to a DevTools client. Exported separately from the
 * hook so tests (and non-React hosts) can drive it with any client.
 */
export const connectTimelineToClient = (
  client: RozeniteDevToolsClient<TimelineEventMap>,
  store: TimelineStore,
) => {
  const sink: TimelineSink = {
    onSnapshot: (chunk) => client.send('snapshot', chunk),
    onEvents: (events) => client.send('events', { events }),
    onCleared: () => client.send('cleared', {}),
  };

  let lease: ReturnType<typeof setTimeout> | null = null;
  const endLease = () => {
    if (lease !== null) {
      clearTimeout(lease);
      lease = null;
    }
  };

  const subscriptions = [
    // A panel (re)connected or renewed its lease: replay what it's missing,
    // then stream.
    client.onMessage(
      'hello',
      guard((payload: TimelineEventMap['hello'] | undefined) => {
        const { sessionKey, afterSeq } = payload ?? {};
        endLease();
        lease = setTimeout(() => {
          lease = null;
          store.detach(sink);
        }, TIMELINE_LEASE_MS);
        store.attach(sink, { sessionKey, afterSeq });
      }),
    ),
    client.onMessage(
      'bye',
      guard(() => {
        endLease();
        store.detach(sink);
      }),
    ),
    client.onMessage(
      'clear',
      guard(() => {
        store.clear();
      }),
    ),
  ];

  // Lets an already-open panel know the app (re)started, so it asks for a
  // fresh snapshot instead of showing a stale one.
  client.send('device-ready', { maxEvents: store.maxEvents });

  return () => {
    subscriptions.forEach((subscription) => subscription.remove());
    endLease();
    store.detach(sink);
  };
};

export const useRozeniteTimelinePlugin = (options: RozeniteTimelinePluginOptions = {}) => {
  const maxEvents = options?.maxEvents ?? DEFAULT_MAX_EVENTS;

  useTimelineAgentTools();

  const client = useRozeniteDevToolsClient<TimelineEventMap>({
    pluginId: TIMELINE_PLUGIN_ID,
  });

  useEffect(() => {
    if (!client) {
      return;
    }
    return connectTimelineToClient(client, getTimelineStore());
  }, [client]);

  const appliedMaxEvents = useRef<number | null>(null);
  useEffect(() => {
    try {
      getTimelineStore().setMaxEvents(maxEvents);
      // A change after the first run: let an open panel pick up the new cap.
      if (appliedMaxEvents.current !== null && appliedMaxEvents.current !== maxEvents) {
        client?.send('device-ready', { maxEvents });
      }
      appliedMaxEvents.current = maxEvents;
    } catch (error) {
      reportInternalError(error);
    }
  }, [maxEvents, client]);

  return client;
};
