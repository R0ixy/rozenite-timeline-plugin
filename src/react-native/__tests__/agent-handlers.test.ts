import { describe, expect, it } from 'vitest';
import { createTimelineAgentHandlers } from '../agent-handlers';
import { createTimelineStore } from '../store';

const setup = () => {
  let now = 0;
  const store = createTimelineStore({ now: () => (now += 1000) });
  const handlers = createTimelineAgentHandlers(() => store);
  return { store, handlers };
};

describe('timeline agent tools', () => {
  it('lists events newest first, paginating with a cursor', () => {
    const { store, handlers } = setup();
    for (let index = 1; index <= 5; index += 1) {
      store.log({ channel: 'c', name: `E${index}` });
    }

    const first = handlers.listEvents({ limit: 2 });
    expect(first.items.map((event) => event.name)).toEqual(['E5', 'E4']);
    expect(first.page).toEqual({ limit: 2, hasMore: true, nextCursor: expect.any(String) });

    // New events arriving between calls don't shift the next page.
    store.log({ channel: 'c', name: 'E6' });

    const second = handlers.listEvents({ limit: 2, cursor: first.page.nextCursor });
    expect(second.items.map((event) => event.name)).toEqual(['E3', 'E2']);

    const third = handlers.listEvents({ limit: 2, cursor: second.page.nextCursor });
    expect(third.items.map((event) => event.name)).toEqual(['E1']);
    expect(third.page).toEqual({ limit: 2, hasMore: false });
  });

  it('lists oldest first on request', () => {
    const { store, handlers } = setup();
    ['a', 'b', 'c'].forEach((name) => store.log({ channel: 'c', name }));

    const page = handlers.listEvents({ order: 'asc', limit: 2 });
    expect(page.items.map((event) => event.name)).toEqual(['a', 'b']);
    expect(
      handlers.listEvents({ order: 'asc', cursor: page.page.nextCursor }).items.map((e) => e.name),
    ).toEqual(['c']);
  });

  it('rejects a cursor from the other order', () => {
    const { store, handlers } = setup();
    ['a', 'b', 'c'].forEach((name) => store.log({ channel: 'c', name }));
    const { page } = handlers.listEvents({ limit: 1 });

    expect(() => handlers.listEvents({ order: 'asc', cursor: page.nextCursor })).toThrow(
      /Invalid cursor/,
    );
  });

  it('filters by channel, level, search and since', () => {
    const { store, handlers } = setup();
    store.log({ channel: 'analytics', name: 'EVENT', preview: 'checkout_started' }); // t=1000
    store.log({ channel: 'flags', name: 'EVALUATE', payload: { key: 'beta' }, level: 'debug' });
    store.log({ channel: 'auth', name: 'LOGIN_FAILED', level: 'error' }); // t=3000

    const names = (args: Parameters<typeof handlers.listEvents>[0]) =>
      handlers.listEvents(args).items.map((event) => event.name);

    expect(names({ channel: 'flags' })).toEqual(['EVALUATE']);
    expect(names({ channel: ['flags', 'auth'] })).toEqual(['LOGIN_FAILED', 'EVALUATE']);
    expect(names({ level: 'error' })).toEqual(['LOGIN_FAILED']);
    expect(names({ search: 'beta' })).toEqual(['EVALUATE']);
    expect(names({ since: 2000 })).toEqual(['LOGIN_FAILED', 'EVALUATE']);
  });

  it('clamps the limit', () => {
    const { store, handlers } = setup();
    for (let index = 0; index < 600; index += 1) {
      store.log({ channel: 'c', name: 'E' });
    }

    expect(handlers.listEvents({}).items).toHaveLength(50);
    expect(handlers.listEvents({ limit: 10_000 }).items).toHaveLength(500);
    expect(handlers.listEvents({ limit: -1 }).items).toHaveLength(50);
  });

  it('gets one event with its payload', () => {
    const { store, handlers } = setup();
    store.log({ channel: 'c', name: 'E', payload: { user: { id: 7 } } });
    const [summary] = handlers.listEvents({}).items;

    expect(handlers.getEvent({ id: summary.id }).event.payload).toEqual({ user: { id: 7 } });
    expect(() => handlers.getEvent({ id: 'nope' })).toThrow(/not found/);
  });

  it('lists channels and clears', () => {
    const { store, handlers } = setup();
    store.log({ channel: 'analytics', name: 'A' });
    store.log({ channel: 'analytics', name: 'B' });
    store.log({ channel: 'flags', name: 'C' });

    expect(handlers.listChannels()).toEqual({
      totalEvents: 3,
      channels: [
        { channel: 'analytics', count: 2, lastTimestamp: 2000 },
        { channel: 'flags', count: 1, lastTimestamp: 3000 },
      ],
    });
    expect(handlers.clear()).toEqual({ cleared: 3 });
    expect(handlers.listChannels()).toEqual({ totalEvents: 0, channels: [] });
  });
});
