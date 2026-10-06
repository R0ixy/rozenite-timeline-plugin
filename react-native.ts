export type {
  JsonValue,
  TimelineChannelEventInput,
  TimelineEvent,
  TimelineEventInput,
  TimelineLevel,
} from './src/shared/types';
export type { Timeline, TimelineChannelLogger } from './src/react-native/timeline';
export type { RozeniteTimelinePluginOptions } from './src/react-native/useRozeniteTimelinePlugin';

export let timeline: typeof import('./src/react-native/timeline').timeline;
export let useRozeniteTimelinePlugin: typeof import('./src/react-native/useRozeniteTimelinePlugin').useRozeniteTimelinePlugin;

// Mirrors the official plugins' entry points. `process.env.NODE_ENV` is
// inlined by Metro, so in a production bundle the condition below folds to a
// constant, the `require` calls in the dead branch are dropped by the
// minifier, and none of the implementation (nor `@rozenite/plugin-bridge`)
// is ever bundled or evaluated.
//
// Neither Lynx runtime has a `window`; `lynx` is a free binding in module
// scope there. Kept inline rather than imported so this stays a foldable
// expression.
declare const lynx: unknown;

const isDev = process.env.NODE_ENV !== 'production';
const isServer = typeof window === 'undefined' && typeof lynx === 'undefined';

if (!isDev || isServer) {
  const noopChannelLogger = (name: unknown) => ({
    channel: typeof name === 'string' ? name : 'default',
    log: () => {},
  });

  timeline = {
    log: () => {},
    channel: noopChannelLogger,
    clear: () => {},
  } as unknown as typeof timeline;
  useRozeniteTimelinePlugin = (() => null) as unknown as typeof useRozeniteTimelinePlugin;
} else {
  timeline = require('./src/react-native/timeline').timeline;
  useRozeniteTimelinePlugin =
    require('./src/react-native/useRozeniteTimelinePlugin').useRozeniteTimelinePlugin;
}
