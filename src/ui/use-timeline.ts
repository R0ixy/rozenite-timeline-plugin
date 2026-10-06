import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { TIMELINE_PLUGIN_ID, type TimelineEventMap } from '../shared/messaging';
import type { TimelineEvent } from '../shared/types';

/** How often the panel re-sends `hello` (until answered) or pings the app. */
export const HEARTBEAT_INTERVAL_MS = 2000;
/** Silence from the app for this long marks it disconnected. */
export const DISCONNECT_AFTER_MS = 7000;
const DEFAULT_MAX_EVENTS = 1000;

/**
 * - `waiting`: no answer from the app yet (hook not mounted, or app not running).
 * - `connected`: the app answered and is streaming.
 * - `disconnected`: the app went quiet; the last known events stay visible.
 */
export type TimelineConnectionStatus = 'waiting' | 'connected' | 'disconnected';

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
  | { type: 'status'; status: TimelineConnectionStatus }
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
    case 'status':
      return state.status === action.status ? state : { ...state, status: action.status };
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
  const statusRef = useRef(state.status);
  statusRef.current = state.status;

  useEffect(() => {
    if (!client) {
      return;
    }

    let lastHeardAt = 0;
    let hasSnapshot = false;
    let nonce = 0;

    const hello = () => client.send('hello', {});
    const markAlive = () => {
      lastHeardAt = Date.now();
      if (statusRef.current === 'disconnected') {
        // Back from the dead: resync, the app may have restarted meanwhile.
        hello();
      }
    };

    const subscriptions = [
      client.onMessage('snapshot', ({ events, maxEvents }) => {
        hasSnapshot = true;
        lastHeardAt = Date.now();
        dispatch({ type: 'snapshot', events, maxEvents });
      }),
      client.onMessage('events', ({ events }) => {
        markAlive();
        dispatch({ type: 'events', events });
      }),
      client.onMessage('cleared', () => {
        markAlive();
        dispatch({ type: 'cleared' });
      }),
      client.onMessage('device-ready', () => {
        // The app (re)started: its buffer is the new truth.
        lastHeardAt = Date.now();
        hello();
      }),
      client.onMessage('pong', () => markAlive()),
    ];

    hello();

    const heartbeat = setInterval(() => {
      if (!hasSnapshot) {
        hello();
        return;
      }
      nonce += 1;
      client.send('ping', { nonce });
      if (Date.now() - lastHeardAt > DISCONNECT_AFTER_MS) {
        dispatch({ type: 'status', status: 'disconnected' });
      }
    }, HEARTBEAT_INTERVAL_MS);

    const sayBye = () => client.send('bye', {});
    window.addEventListener('pagehide', sayBye);

    return () => {
      clearInterval(heartbeat);
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
