import { useRozeniteDevToolsClient, type RozeniteDevToolsClient } from '@rozenite/plugin-bridge';
import { useEffect } from 'react';
import { TIMELINE_PLUGIN_ID, type TimelineEventMap } from '../shared/messaging';
import { DEFAULT_MAX_EVENTS, type TimelineSink, type TimelineStore } from './store';
import { getTimelineStore } from './timeline';
import { useTimelineAgentTools } from './useTimelineAgentTools';

export type RozeniteTimelinePluginOptions = {
  /** Ring buffer capacity. @default 1000 */
  maxEvents?: number;
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
    onEvents: (events) => client.send('events', { events }),
    onCleared: () => client.send('cleared', {}),
  };

  const subscriptions = [
    // A panel (re)connected: replay the whole buffer, then stream.
    client.onMessage('hello', () => {
      const events = store.attach(sink);
      client.send('snapshot', { events, maxEvents: store.maxEvents });
    }),
    client.onMessage('bye', () => store.detach(sink)),
    client.onMessage('clear', () => {
      store.clear();
    }),
    client.onMessage('ping', ({ nonce }) => client.send('pong', { nonce })),
  ];

  // Lets an already-open panel know the app (re)started, so it asks for a
  // fresh snapshot instead of showing a stale one.
  client.send('device-ready', { maxEvents: store.maxEvents });

  return () => {
    subscriptions.forEach((subscription) => subscription.remove());
    store.detach(sink);
  };
};

export const useRozeniteTimelinePlugin = (options: RozeniteTimelinePluginOptions = {}) => {
  const maxEvents = options?.maxEvents ?? DEFAULT_MAX_EVENTS;

  useEffect(() => {
    getTimelineStore().setMaxEvents(maxEvents);
  }, [maxEvents]);

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

  return client;
};
