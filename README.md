# rozenite-timeline-plugin

A generic **event timeline** for React Native DevTools, built on [Rozenite](https://www.rozenite.dev).

Your app's console is full of noise. This plugin gives app events their own stream: analytics calls, feature-flag evaluations, auth state transitions, domain logs. Each event has a channel, a level and a JSON payload, and you can filter and search them in a dedicated DevTools panel. It plays the same role as Reactotron's `display()`, but runs in React Native DevTools.

- An imperative API (`timeline.log(...)`) that you can call from anywhere: components, service classes, SDK wrappers, middleware.
- Events logged before DevTools connects are kept in a ring buffer and replayed when the panel opens or reloads.
- Payloads are serialized defensively: cycles, `Error`s, `Map`/`Set`, BigInt and functions are handled, and oversized payloads are truncated. A call can never throw into your app.
- A **no-op in production**. The implementation is never bundled or evaluated.
- Agent tools let coding agents read the timeline without the panel being open.
- Works with Expo and bare React Native (New Architecture, Hermes), with no runtime dependencies beyond Rozenite's own.

## Installation

```bash
npm install rozenite-timeline-plugin
# or: bun add / yarn add / pnpm add rozenite-timeline-plugin
```

Rozenite must be enabled in your Metro config. If it isn't yet, install `@rozenite/metro` and wrap your config with `withRozenite`:

```bash
npm install -D @rozenite/metro
```

```js
// metro.config.js (Expo)
const { getDefaultConfig } = require('expo/metro-config');
const { withRozenite } = require('@rozenite/metro');

module.exports = withRozenite(getDefaultConfig(__dirname), { enabled: true });
```

```js
// metro.config.js (bare React Native)
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withRozenite } = require('@rozenite/metro');

module.exports = withRozenite(mergeConfig(getDefaultConfig(__dirname), {}), {
  enabled: process.env.WITH_ROZENITE === 'true',
});
```

Restart Metro. Its logs should list `rozenite-timeline-plugin` among the loaded plugins, and a **Timeline** panel appears in React Native DevTools.

## Quick start

```tsx
import { timeline, useRozeniteTimelinePlugin } from 'rozenite-timeline-plugin';

export default function App() {
  // Once, at the app root: connects the buffer to DevTools.
  useRozeniteTimelinePlugin();
  return <Root />;
}

// Anywhere, React or not:
timeline.log({ channel: 'analytics', name: 'EVENT', preview: 'checkout_started', payload: { cartId: 'c_42' } });
```

## API reference

### `useRozeniteTimelinePlugin(options?)`

Call it **once**, in a component that stays mounted (your app root). It connects the timeline to DevTools and registers the agent tools.

| Option      | Type     | Default | Description                                         |
| ----------- | -------- | ------- | --------------------------------------------------- |
| `maxEvents` | `number` | `1000`  | Ring buffer capacity. The oldest events are evicted first. |

`timeline.log()` works with or without this hook. Without it, events stay in the buffer until a hook mounts.

### `timeline.log(event)`

```ts
timeline.log({
  channel: 'analytics',          // required; groups and filters events
  name: 'EVENT',                 // short type label, e.g. EVENT | SCREEN | IDENTIFY
  preview: 'checkout_started',   // optional one-line summary shown in the list
  payload: { any: 'value' },     // optional; shown as a JSON tree
  level: 'info',                 // 'debug' | 'info' | 'warn' | 'error'; default 'info'
  important: false,              // highlights the row
  tags: ['checkout'],            // searchable labels
});
```

Each event automatically gets an `id`, a `timestamp` (ms since the epoch) and a monotonic sequence number (`seq`).

`log()` never throws. Malformed input is coerced: a missing channel becomes `'default'`, a missing name becomes `'EVENT'` and an unknown level becomes `'info'`. If anything inside the plugin fails, the event is dropped and one warning goes to the console.

### `timeline.channel(name)`

Returns a logger bound to one channel:

```ts
const analyticsTimeline = timeline.channel('analytics');
analyticsTimeline.log({ name: 'SCREEN', preview: 'Home', payload: { tab: 'feed' } });
```

### `timeline.clear()`

Empties the buffer in the app and in an open panel.

### Types

`TimelineEventInput`, `TimelineChannelEventInput`, `TimelineEvent`, `TimelineLevel`, `JsonValue`, `Timeline`, `TimelineChannelLogger` and `RozeniteTimelinePluginOptions` are all exported.

## How it behaves

**Buffering.** Events go into a ring buffer of `maxEvents` entries from the moment the module loads. When a panel connects, or reloads, it gets the whole buffer, then a live stream.

**Overhead.** While the panel is open, `log()` serializes the event and sends it synchronously, inside the call — like the Redux DevTools plugin, there is no batching delay. Plain JSON payloads take a fast path (a cheap check, then native `JSON.stringify`), and the payload travels as a JSON string that the panel parses only when you open the event. While no panel is listening, `log()` only pushes onto the ring buffer and payloads are serialized later, when a panel or agent tool first asks for them; an object you mutate after logging in that state may show its later value, so log a copy if that matters.

**Serialization.** Payloads become plain JSON: cycles become `"[Circular]"`, `Error`s become `{ name, message, stack, cause? }`, and `Date`, `Map`/`Set`, BigInt, functions and throwing getters all get readable stand-ins. Each payload is capped at 64 KiB (plus limits on string length, entries and depth). Anything cut is marked `[Truncated]` and the panel shows a "truncated" badge.

**Production.** With `NODE_ENV === 'production'` every export is a no-op stub. Metro inlines `NODE_ENV`, so the real implementation sits in a dead branch that the minifier removes. You can leave `timeline.log` calls in shipped code.

## The panel

A virtualized list (newest at the bottom, auto-scrolling until you scroll up) with time, channel badge, name, preview and level colour; important rows are highlighted. Click a row for a detail pane with a collapsible, copyable JSON tree. The toolbar has search (name, preview, tags and payload), channel and level filters, pause/resume, clear and JSON export. A status indicator shows whether the panel is still waiting for the app or connected. Light and dark themes come from `@rozenite/ui`.

## Agent tools

The plugin registers [Rozenite for Agents](https://www.rozenite.dev/docs/agent/overview) tools under the `rozenite-timeline-plugin` domain. They are available while `useRozeniteTimelinePlugin` is mounted, even if the panel is closed.

| Tool             | Arguments                                                                 | Returns |
| ---------------- | ------------------------------------------------------------------------- | ------- |
| `list-events`    | `channel?` (string or string[]), `level?` (string or string[]), `search?`, `since?` (ms epoch), `limit?` (default 50, max 500), `cursor?`, `order?` (`'desc'` newest first by default, or `'asc'`) | `{ items, page: { limit, hasMore, nextCursor? } }`. Payloads are left out by default; add `payload` to the requested fields (`--fields`) to include them. |
| `get-event`      | `id`                                                                      | `{ event }` with its payload |
| `list-channels`  | none                                                                      | `{ channels: [{ channel, count, lastTimestamp }], totalEvents }` |
| `clear`          | none                                                                      | `{ cleared }`. Destructive: it also clears the panel. |

Cursors are anchored to sequence numbers, so pages stay consistent while new events arrive.

From the CLI (Metro must be running):

```bash
npx rozenite agent session create
```

```bash
npx rozenite agent rozenite-timeline-plugin call --session <id> --tool list-events --args '{"channel":"analytics","limit":20}' --fields id,timestamp,name,preview,payload
```

## Recipes

These recipes are illustrative and vendor-neutral. Adapt them to your own SDKs.

### Analytics wrapper

A thin facade that mirrors every call to the `analytics` channel. In development you see exactly what would be sent. In production `timeline` is a no-op, and only the vendor call remains.

```ts
// analytics.ts
import { timeline } from 'rozenite-timeline-plugin';
import { vendor } from './vendor-sdk'; // your analytics SDK

const analyticsTimeline = timeline.channel('analytics');

export const analytics = {
  track(event: string, properties?: Record<string, unknown>) {
    analyticsTimeline.log({ name: 'EVENT', preview: event, payload: properties });
    vendor.track(event, properties);
  },
  screen(name: string, properties?: Record<string, unknown>) {
    analyticsTimeline.log({ name: 'SCREEN', preview: name, payload: properties });
    vendor.screen(name, properties);
  },
  identify(userId: string, traits?: Record<string, unknown>) {
    analyticsTimeline.log({ name: 'IDENTIFY', preview: userId, payload: traits, important: true });
    vendor.identify(userId, traits);
  },
};
```

To log *instead of* sending in development, guard the vendor call with `if (!__DEV__)`.

### Feature-flag evaluations

Record the key, value and source of every evaluation on a `flags` channel:

```ts
import { timeline } from 'rozenite-timeline-plugin';

const flagsTimeline = timeline.channel('flags');

export function getFlag<T>(key: string, fallback: T): T {
  const remote = flagClient.get(key); // your flag client
  const value = (remote ?? fallback) as T;
  const source = remote === undefined ? 'default' : 'remote';

  flagsTimeline.log({
    name: 'EVALUATE',
    preview: `${key} = ${JSON.stringify(value)}`,
    payload: { key, value, source },
    level: 'debug',
    tags: [source],
  });
  return value;
}
```

### Redux / state middleware

Log selected actions to a channel without pulling in the full Redux DevTools:

```ts
import type { Middleware } from '@reduxjs/toolkit';
import { timeline } from 'rozenite-timeline-plugin';

const stateTimeline = timeline.channel('state');
const LOGGED = /^(auth|cart)\//; // only the slices you care about

export const timelineMiddleware: Middleware = () => (next) => (action) => {
  const result = next(action);
  const { type, payload } = action as { type: string; payload?: unknown };
  if (LOGGED.test(type)) {
    stateTimeline.log({
      name: type.split('/')[0].toUpperCase(),
      preview: type,
      payload,
      level: type.endsWith('/rejected') ? 'error' : 'info',
    });
  }
  return result;
};
```

The same pattern works for Zustand (`subscribe`), MobX (`spy`) or any event emitter.

## Example app

`example/` is an Expo app that logs to several channels (`app`, `analytics`, `flags`, `auth`, `debug`, `perf`). It also includes a stress payload with cycles, a `Map`, a BigInt and 200 KB of text, and a 500-event burst.

```bash
bun install && bun run build
cd example
bun install
bun run plugin:refresh   # rebuilds, packs and reinstalls the plugin tarball
bun run ios              # or: bun run android
```

## Development

```bash
bun install
bun run dev        # rozenite dev host on http://localhost:8888, with a simulated app
bun run test       # vitest: unit tests plus panel <-> app round trips via @rozenite/testing
bun run typecheck
bun run build      # rozenite build → dist/
```

`bun run dev` runs a **Simulate an app** flow (see `rozenite.config.ts`). It answers the panel like the real device hook, so you can work on the UI without a simulator.

### Verifying the production no-op

- `src/__tests__/react-native-entry.test.ts` checks that a production import never requires the implementation, and that the stubs survive bad calls.
- `bun run verify:prod` exports the example app's production iOS and Android bundles and greps them for strings that only exist in the plugin's implementation (`scripts/verify-production-bundle.mjs`). None may appear. A development export, used as a control, must contain all of them.

## License

MIT
