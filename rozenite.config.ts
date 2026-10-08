import type { RozeniteConfig } from '@rozenite/vite-plugin';
import type { TimelineEvent } from './src/shared/types';

// Evaluated with no `require` in scope (see @rozenite/vite-plugin's
// load-config), so only type-only imports are allowed here.

type DevFlowContext = {
  signal: AbortSignal;
  send: (type: string, payload: unknown) => void;
  onMessage: (
    matcher: { type?: string; direction?: 'in' | 'out' },
    listener: (message: { payload: unknown }) => void,
  ) => { remove: () => void };
};

/** A fake app for `rozenite dev`: answers the panel like the device hook does. */
const simulateApp = async ({ send, onMessage, signal }: DevFlowContext) => {
  let seq = 0;
  const event = ({ payload, ...fields }: Partial<TimelineEvent> & { payload?: unknown }): TimelineEvent => ({
    id: `dev-${++seq}`,
    seq,
    timestamp: Date.now(),
    channel: 'analytics',
    name: 'EVENT',
    level: 'info',
    important: false,
    tags: [],
    ...fields,
    ...(payload === undefined ? {} : { payloadJson: JSON.stringify(payload) }),
  });

  const events = [
    event({ channel: 'analytics', name: 'SCREEN', preview: 'Home', payload: { tab: 'feed' } }),
    event({ channel: 'flags', name: 'EVALUATE', preview: 'new-onboarding = true', level: 'debug', payload: { key: 'new-onboarding', value: true, source: 'remote' } }),
    event({ channel: 'auth', name: 'REFRESH_FAILED', preview: '401 from /oauth/token', level: 'error', important: true, payload: { error: { name: 'Error', message: 'Unauthorized' } } }),
  ];
  let streaming = false;

  const subscriptions = [
    onMessage({ type: 'hello', direction: 'out' }, () => {
      streaming = true;
      send('snapshot', { events, maxEvents: 1000 });
    }),
    onMessage({ type: 'bye', direction: 'out' }, () => (streaming = false)),
    onMessage({ type: 'ping', direction: 'out' }, ({ payload }) => send('pong', payload)),
    onMessage({ type: 'clear', direction: 'out' }, () => {
      events.length = 0;
      send('cleared', {});
    }),
  ];

  // A live event every 1.5 s while the panel is listening.
  const timer = setInterval(() => {
    if (!streaming) return;
    const next = event({ preview: `tap_${seq}`, payload: { index: seq } });
    events.push(next);
    send('events', { events: [next] });
  }, 1500);

  send('device-ready', { maxEvents: 1000 });

  await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
  clearInterval(timer);
  subscriptions.forEach((subscription) => subscription.remove());
};

export default {
  panels: [{ name: 'Timeline', source: './src/ui/panel.tsx' }],
  // The app side is plain JS on top of @rozenite/plugin-bridge (no native
  // modules), so it runs on react-native-web as well.
  integrations: ['react-native', 'react-native-web'],
  dev: {
    flows: [{ name: 'Simulate an app', autoRun: true, run: simulateApp }],
  },
} satisfies RozeniteConfig;
