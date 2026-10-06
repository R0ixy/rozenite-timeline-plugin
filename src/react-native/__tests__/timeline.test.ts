import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTimelineStore, timeline } from '../timeline';

describe('timeline (public API)', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__ROZENITE_TIMELINE_STORE__;
  });

  it('logs into the shared store', () => {
    timeline.log({ channel: 'analytics', name: 'EVENT', preview: 'checkout_started' });

    expect(getTimelineStore().getEvents()).toEqual([
      expect.objectContaining({ channel: 'analytics', name: 'EVENT', preview: 'checkout_started' }),
    ]);
  });

  it('binds a channel', () => {
    const analytics = timeline.channel('analytics');
    analytics.log({ name: 'SCREEN', preview: 'Home', payload: { tab: 'feed' } });
    // A channel passed by an untyped caller must not override the binding.
    analytics.log({ name: 'EVENT', channel: 'other' } as never);

    expect(analytics.channel).toBe('analytics');
    expect(getTimelineStore().getEvents()).toEqual([
      expect.objectContaining({ channel: 'analytics', name: 'SCREEN', payload: { tab: 'feed' } }),
      expect.objectContaining({ channel: 'analytics', name: 'EVENT' }),
    ]);
  });

  it('clears', () => {
    timeline.log({ channel: 'c', name: 'E' });
    timeline.clear();

    expect(getTimelineStore().getEvents()).toEqual([]);
  });

  it('never lets an internal failure reach the caller', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(getTimelineStore(), 'log').mockImplementation(() => {
      throw new Error('internal');
    });

    expect(() => timeline.log({ channel: 'c', name: 'E' })).not.toThrow();
    expect(() => timeline.channel('c').log({ name: 'E' })).not.toThrow();
    expect(() => timeline.log(null as never)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps one store per runtime', () => {
    expect(getTimelineStore()).toBe(getTimelineStore());
  });
});
