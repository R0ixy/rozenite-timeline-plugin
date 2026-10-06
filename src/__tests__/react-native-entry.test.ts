import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The entry point picks its implementation with a bare `require` of the
 * TypeScript sources, which Node cannot load here. That makes the branch
 * observable: the development branch fails with "Cannot find module", and a
 * production import that succeeds proves the implementation was never
 * required at all.
 */
const originalNodeEnv = process.env.NODE_ENV;

const loadEntry = async (nodeEnv: string) => {
  process.env.NODE_ENV = nodeEnv;
  vi.resetModules();
  return import('../../react-native');
};

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe('react-native entry, production build', () => {
  it('never requires the implementation', async () => {
    await expect(loadEntry('production')).resolves.toBeDefined();
  });

  it('exports inert stubs that cannot throw', async () => {
    const { timeline, useRozeniteTimelinePlugin } = await loadEntry('production');

    expect(timeline.log({ channel: 'analytics', name: 'EVENT', payload: { a: 1 } })).toBeUndefined();
    expect(timeline.clear()).toBeUndefined();
    const analytics = timeline.channel('analytics');
    expect(analytics.channel).toBe('analytics');
    expect(analytics.log({ name: 'SCREEN' })).toBeUndefined();
    expect(useRozeniteTimelinePlugin({ maxEvents: 10 })).toBeNull();

    // Sloppy JS call shapes must degrade, not crash, in a release build.
    const sloppyCalls = [
      () => (timeline.log as () => void)(),
      () => (timeline.log as (input: unknown) => void)(null),
      () => (timeline.channel as unknown as () => { log: () => void })().log(),
      () => (useRozeniteTimelinePlugin as () => unknown)(),
    ];
    for (const call of sloppyCalls) {
      expect(call).not.toThrow();
    }
  });
});

describe('react-native entry, development build', () => {
  it('requires the real implementation', async () => {
    await expect(loadEntry('development')).rejects.toThrow(
      /Cannot find module '\.\/src\/react-native\/timeline'/,
    );
  });
});
