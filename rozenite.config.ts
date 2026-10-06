import type { RozeniteConfig } from '@rozenite/vite-plugin';
import type { TimelineEvent } from './src/shared/types';

// This file is evaluated by transforming it with esbuild and running it with
// no `require` in scope (see @rozenite/vite-plugin's load-config), so only
// type-only imports are allowed. Everything below is inline on purpose.

type DevFlowMessage = { direction: 'in' | 'out'; type: string; payload: unknown };

type DevFlowContext = {
  signal: AbortSignal;
  send: (type: string, payload: unknown) => void;
  onMessage: (
    matcher: { type?: string; direction?: DevFlowMessage['direction'] },
    listener: (message: DevFlowMessage) => void,
  ) => { remove: () => void };
};

/** A fake app for `rozenite dev`: answers the panel like the real device hook. */
const simulateApp = async ({ send, onMessage, signal }: DevFlowContext) => {
  let seq = 0;
  const makeEvent = (event: Omit<TimelineEvent, 'id' | 'seq' | 'timestamp' | 'tags' | 'level' | 'important'> & Partial<TimelineEvent>): TimelineEvent => {
    seq += 1;
    return {
      id: `dev-${seq}`,
      seq,
      timestamp: Date.now(),
      level: 'info',
      important: false,
      tags: [],
      ...event,
    };
  };

  const buffered: TimelineEvent[] = [
    makeEvent({ channel: 'app', name: 'BOOT', preview: 'JS bundle evaluated' }),
    makeEvent({ channel: 'auth', name: 'SESSION_RESTORED', preview: 'user_123', payload: { expiresIn: 3600 } }),
    makeEvent({ channel: 'analytics', name: 'SCREEN', preview: 'Home', payload: { tab: 'feed' } }),
    makeEvent({
      channel: 'flags',
      name: 'EVALUATE',
      preview: 'new-onboarding = true',
      level: 'debug',
      tags: ['remote'],
      payload: { key: 'new-onboarding', value: true, source: 'remote' },
    }),
    makeEvent({
      channel: 'analytics',
      name: 'IDENTIFY',
      preview: 'user_123',
      important: true,
      payload: { plan: 'pro', signedUpAt: '2026-01-02T03:04:05.000Z' },
    }),
    makeEvent({
      channel: 'auth',
      name: 'REFRESH_FAILED',
      preview: '401 from /oauth/token',
      level: 'error',
      important: true,
      payload: { error: { name: 'Error', message: 'Unauthorized', stack: 'Error: Unauthorized\n    at refresh (auth.ts:42)' }, attempt: 2 },
    }),
    makeEvent({
      channel: 'debug',
      name: 'STRESS',
      preview: 'cycles, Map, BigInt',
      level: 'warn',
      truncated: true,
      payload: { map: { __type: 'Map', size: 1, entries: [['a', 1]] }, big: '100000000000000000000n', self: '[Circular]', blob: 'xxxx… [truncated 190000 chars]' },
    }),
  ];

  let streaming = false;
  const subscriptions = [
    onMessage({ type: 'hello', direction: 'out' }, () => {
      streaming = true;
      send('snapshot', { events: buffered, maxEvents: 1000 });
    }),
    onMessage({ type: 'ping', direction: 'out' }, (message) => {
      send('pong', message.payload);
    }),
    onMessage({ type: 'clear', direction: 'out' }, () => {
      buffered.length = 0;
      send('cleared', {});
    }),
    onMessage({ type: 'bye', direction: 'out' }, () => {
      streaming = false;
    }),
  ];

  const screens = ['Home', 'Search', 'Product', 'Cart', 'Checkout'];
  const timer = setInterval(() => {
    if (!streaming) return;
    const event = makeEvent({
      channel: 'analytics',
      name: 'EVENT',
      preview: `tap_${screens[seq % screens.length].toLowerCase()}`,
      payload: { screen: screens[seq % screens.length], index: seq },
    });
    buffered.push(event);
    send('events', { events: [event] });
  }, 1500);

  send('device-ready', { maxEvents: 1000 });

  return await new Promise((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        clearInterval(timer);
        subscriptions.forEach((subscription) => subscription.remove());
        resolve({ message: 'Simulated app stopped.' });
      },
      { once: true },
    );
  });
};

export default {
  panels: [
    {
      name: 'Timeline',
      source: './src/ui/panel.tsx',
    },
  ],
  // The app side only uses `@rozenite/plugin-bridge` and plain JS — no native
  // modules — so it runs on react-native-web as well.
  integrations: ['react-native', 'react-native-web'],
  dev: {
    flows: [{ name: 'Simulate an app', autoRun: true, run: simulateApp }],
  },
} satisfies RozeniteConfig;
