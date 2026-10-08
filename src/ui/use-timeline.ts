import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge';
import { useCallback, useEffect, useReducer } from 'react';
import { TIMELINE_PLUGIN_ID, type TimelineEventMap } from '../shared/messaging';
import type { TimelineEvent } from '../shared/types';

const DEFAULT_MAX_EVENTS = 1000;

/**
 * - `waiting`: no answer from the app yet (hook not mounted, or app not running).
 * - `connected`: the app answered and is streaming.
 *
 * There is no "disconnected" state: when the app's JS context goes away
 * (reload, crash, lost connection), the Rozenite host replaces this panel with
 * a loader and mounts a fresh one once the app is back.
 */
export type TimelineConnectionStatus = 'waiting' | 'connected';

export type TimelineState = {
  status: TimelineConnectionStatus;
  events: TimelineEvent[];
  /** Arrived while paused; appended on resume. */
  held: TimelineEvent[];
  paused: boolean;
  maxEvents: number;
  /** Every channel seen this session, in first-seen order. */
  channels: string[];
};

export type TimelineAction =
  | { type: 'snapshot'; events: TimelineEvent[]; maxEvents: number }
  | { type: 'events'; events: TimelineEvent[] }
  | { type: 'cleared' }
  | { type: 'set-paused'; paused: boolean };

export const initialTimelineState: TimelineState = {
  status: 'waiting',
  events: [],
  held: [],
  paused: false,
  maxEvents: DEFAULT_MAX_EVENTS,
  channels: [],
};

const capToNewest = (events: TimelineEvent[], max: number) =>
  events.length > max ? events.slice(events.length - max) : events;

const withChannels = (channels: string[], events: TimelineEvent[]): string[] => {
  let next: string[] | null = null;
  for (const event of events) {
    const list: string[] = next ?? channels;
    if (!list.includes(event.channel)) {
      next = [...list, event.channel];
    }
  }
  return next ?? channels;
};

export const timelineReducer = (state: TimelineState, action: TimelineAction): TimelineState => {
  switch (action.type) {
    case 'snapshot': {
      const maxEvents = action.maxEvents > 0 ? action.maxEvents : state.maxEvents;
      // The snapshot is the app's whole buffer, so it replaces what we had.
      return {
        ...state,
        status: 'connected',
        maxEvents,
        events: capToNewest(action.events, maxEvents),
        held: [],
        channels: withChannels(state.channels, action.events),
      };
    }
    case 'events': {
      const channels = withChannels(state.channels, action.events);
      if (state.paused) {
        return {
          ...state,
          channels,
          held: capToNewest([...state.held, ...action.events], state.maxEvents),
        };
      }
      return {
        ...state,
        channels,
        events: capToNewest([...state.events, ...action.events], state.maxEvents),
      };
    }
    case 'cleared':
      return { ...state, events: [], held: [] };
    case 'set-paused': {
      if (action.paused === state.paused) {
        return state;
      }
      if (action.paused) {
        return { ...state, paused: true };
      }
      return {
        ...state,
        paused: false,
        held: [],
        events: capToNewest([...state.events, ...state.held], state.maxEvents),
      };
    }
  }
};

export const useTimeline = () => {
  const client = useRozeniteDevToolsClient<TimelineEventMap>({ pluginId: TIMELINE_PLUGIN_ID });
  const [state, dispatch] = useReducer(timelineReducer, initialTimelineState);

  useEffect(() => {
    if (!client) {
      return;
    }

    // Ask for the app's buffer now, and again whenever the app (re)connects:
    // if the panel opens first, the hook announces itself with `device-ready`.
    const hello = () => client.send('hello', {});

    const subscriptions = [
      client.onMessage('snapshot', ({ events, maxEvents }) => {
        dispatch({ type: 'snapshot', events, maxEvents });
      }),
      client.onMessage('events', ({ events }) => dispatch({ type: 'events', events })),
      client.onMessage('cleared', () => dispatch({ type: 'cleared' })),
      client.onMessage('device-ready', hello),
    ];

    hello();

    // Stop the app from streaming to a panel that's gone.
    const sayBye = () => client.send('bye', {});
    window.addEventListener('pagehide', sayBye);

    return () => {
      window.removeEventListener('pagehide', sayBye);
      subscriptions.forEach((subscription) => subscription.remove());
      sayBye();
    };
  }, [client]);

  const clear = useCallback(() => {
    dispatch({ type: 'cleared' });
    client?.send('clear', {});
  }, [client]);

  const setPaused = useCallback((paused: boolean) => {
    dispatch({ type: 'set-paused', paused });
  }, []);

  return { ...state, clear, setPaused };
};
