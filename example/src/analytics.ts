import { timeline } from 'rozenite-timeline-plugin';

/**
 * A vendor-neutral analytics facade. In development every call is mirrored to
 * the `analytics` timeline channel; in production `timeline` is a no-op stub,
 * so only the (here: imaginary) vendor SDK call remains.
 */
const analyticsTimeline = timeline.channel('analytics');

export const analytics = {
  track(event: string, properties?: Record<string, unknown>) {
    analyticsTimeline.log({ name: 'EVENT', preview: event, payload: properties });
    // vendorSdk.track(event, properties);
  },
  screen(name: string, properties?: Record<string, unknown>) {
    analyticsTimeline.log({ name: 'SCREEN', preview: name, payload: properties });
  },
  identify(userId: string, traits?: Record<string, unknown>) {
    analyticsTimeline.log({ name: 'IDENTIFY', preview: userId, payload: traits, important: true });
  },
};
