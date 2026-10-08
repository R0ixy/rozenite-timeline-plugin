import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  TIMELINE_LEASE_RENEW_MS,
  TIMELINE_PLUGIN_ID,
  type TimelineEventMap,
} from '../shared/messaging';
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
  /**
   * Paused in the app, not just on screen: the app stops streaming and goes
   * back to buffering; resuming fetches only what was logged meanwhile.
   */
  paused: boolean;
  maxEvents: number;
  /** Every channel seen this session, in first-seen order. */
  channels: string[];
  /** The app buffer we mirror; `null` until the first snapshot. */
  sessionKey: string | null;
  /** Highest seq received, so a reconnect only fetches newer events. */
  lastSeq: number;
};

export type TimelineAction =
  | ({ type: 'snapshot' } & TimelineEventMap['snapshot'])
  | { type: 'events'; events: TimelineEvent[] }
  | { type: 'cleared' }
  | { type: 'set-paused'; paused: boolean };

export const initialTimelineState: TimelineState = {
  status: 'waiting',
  events: [],
  paused: false,
  maxEvents: DEFAULT_MAX_EVENTS,
  channels: [],
  sessionKey: null,
  lastSeq: 0,
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

/**
 * Appends events newer than `afterSeq`. A replay can overlap events that
 * were already streamed (a lease renewal races with live sends), so seq is
 * the de-duplication key.
 */
const append = (
  state: TimelineState,
  base: TimelineEvent[],
  afterSeq: number,
  incoming: TimelineEvent[],
  maxEvents: number,
) => {
  const fresh = incoming.filter((event) => event.seq > afterSeq);
  return {
    events: fresh.length === 0 && base === state.events ? base : capToNewest([...base, ...fresh], maxEvents),
    lastSeq: fresh.length === 0 ? afterSeq : fresh[fresh.length - 1].seq,
    channels: withChannels(state.channels, fresh),
  };
};

export const timelineReducer = (state: TimelineState, action: TimelineAction): TimelineState => {
  switch (action.type) {
    case 'snapshot': {
      // In flight when we paused: resuming fetches it again.
      if (state.paused) {
        return state;
      }
      const maxEvents = action.maxEvents > 0 ? action.maxEvents : state.maxEvents;
      // A reset, or a different buffer (app restarted, or cleared), replaces
      // what we had; otherwise the chunk continues it.
      const replace = action.reset || action.sessionKey !== state.sessionKey;
      return {
        ...state,
        status: 'connected',
        maxEvents,
        sessionKey: action.sessionKey,
        ...append(state, replace ? [] : state.events, replace ? 0 : state.lastSeq, action.events, maxEvents),
      };
    }
    case 'events':
      // Before the first snapshot (or while paused) the replay covers these.
      if (state.paused || state.sessionKey === null) {
        return state;
      }
      return { ...state, ...append(state, state.events, state.lastSeq, action.events, state.maxEvents) };
    case 'cleared':
      return { ...state, events: [] };
    case 'set-paused':
      return action.paused === state.paused ? state : { ...state, paused: action.paused };
  }
};

export const useTimeline = () => {
  const client = useRozeniteDevToolsClient<TimelineEventMap>({ pluginId: TIMELINE_PLUGIN_ID });
  const [state, dispatch] = useReducer(timelineReducer, initialTimelineState);
  // Message handlers and timers read the latest state through this.
  const stateRef = useRef(state);
  stateRef.current = state;

  /** Asks the app to stream, resuming after the last event we have. */
  const sendHello = useCallback(() => {
    const { sessionKey, lastSeq } = stateRef.current;
    client?.send('hello', sessionKey === null ? {} : { sessionKey, afterSeq: lastSeq });
  }, [client]);

  useEffect(() => {
    if (!client) {
      return;
    }

    const helloUnlessPaused = () => {
      if (!stateRef.current.paused) {
        sendHello();
      }
    };

    const subscriptions = [
      client.onMessage('snapshot', (chunk) => dispatch({ type: 'snapshot', ...chunk })),
      client.onMessage('events', ({ events }) => dispatch({ type: 'events', events })),
      client.onMessage('cleared', () => dispatch({ type: 'cleared' })),
      // The app (re)connected or changed maxEvents. If the panel opened
      // first, this is what starts the stream.
      client.onMessage('device-ready', helloUnlessPaused),
    ];

    helloUnlessPaused();
    // Renews the app's lease. Cheap: it only replays events we're missing.
    const renew = setInterval(helloUnlessPaused, TIMELINE_LEASE_RENEW_MS);

    // Stop the app from streaming to a panel that's gone.
    const sayBye = () => client.send('bye', {});
    window.addEventListener('pagehide', sayBye);

    return () => {
      clearInterval(renew);
      window.removeEventListener('pagehide', sayBye);
      subscriptions.forEach((subscription) => subscription.remove());
      sayBye();
    };
  }, [client, sendHello]);

  const clear = useCallback(() => {
    dispatch({ type: 'cleared' });
    client?.send('clear', {});
  }, [client]);

  const setPaused = useCallback(
    (paused: boolean) => {
      dispatch({ type: 'set-paused', paused });
      if (paused) {
        client?.send('bye', {});
      } else {
        sendHello();
      }
    },
    [client, sendHello],
  );

  return { ...state, clear, setPaused };
};
