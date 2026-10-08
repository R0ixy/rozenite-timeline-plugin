import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializeToJson } from '../../shared/serialize';
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

  it('reports latestSeq and lists only what came after it', () => {
    const { store, handlers } = setup();
    store.log({ channel: 'c', name: 'BEFORE' });
    const { latestSeq, items } = handlers.listEvents({ limit: 1 });
    expect(items.map((event) => event.name)).toEqual(['BEFORE']);
    expect(latestSeq).toBe(1);

    store.log({ channel: 'c', name: 'AFTER_1' });
    store.log({ channel: 'c', name: 'AFTER_2' });

    expect(handlers.listEvents({ afterSeq: latestSeq, order: 'asc' }).items.map((event) => event.name)).toEqual([
      'AFTER_1',
      'AFTER_2',
    ]);
    expect(handlers.listEvents({}).latestSeq).toBe(3);
  });

  it('filters by exact name', () => {
    const { store, handlers } = setup();
    store.log({ channel: 'payments', name: 'PAYMENT_FAILED' });
    store.log({ channel: 'payments', name: 'PAYMENT_FAILED_RETRY' });
    store.log({ channel: 'payments', name: 'PAYMENT_SUCCEEDED' });

    expect(handlers.listEvents({ name: 'PAYMENT_FAILED' }).items.map((event) => event.name)).toEqual([
      'PAYMENT_FAILED',
    ]);
    expect(
      handlers.listEvents({ name: ['PAYMENT_FAILED', 'PAYMENT_SUCCEEDED'], order: 'asc' }).items.map((e) => e.name),
    ).toEqual(['PAYMENT_FAILED', 'PAYMENT_SUCCEEDED']);
  });
});

describe('wait-for-event', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the first matching event logged after the call, ignoring older and non-matching ones', async () => {
    const { store, handlers } = setup();
    store.log({ channel: 'payments', name: 'PAYMENT_FAILED', preview: 'old' });

    const waiting = handlers.waitForEvent({ channel: 'payments', name: 'PAYMENT_FAILED' });
    store.log({ channel: 'analytics', name: 'PAYMENT_FAILED' });
    store.log({ channel: 'payments', name: 'PAYMENT_FAILED', preview: 'new', payload: { code: 'card_declined' } });

    const result = await waiting;
    expect(result.timedOut).toBe(false);
    expect(result.event).toMatchObject({ preview: 'new', payload: { code: 'card_declined' } });
    expect(result.latestSeq).toBe(3);
  });

  it('returns an already-logged match right away when given afterSeq', async () => {
    const { store, handlers } = setup();
    store.log({ channel: 'c', name: 'A' });
    store.log({ channel: 'c', name: 'B', payload: { n: 2 } });

    const result = await handlers.waitForEvent({ afterSeq: 1, name: 'B' });

    expect(result).toMatchObject({ timedOut: false, event: { name: 'B', payload: { n: 2 } } });
  });

  it('times out with a null event and stops listening', async () => {
    vi.useFakeTimers();
    const { store, handlers } = setup();
    const unsubscribe = vi.fn();
    const onLogged = vi.spyOn(store, 'onLogged').mockImplementation(() => unsubscribe);

    const waiting = handlers.waitForEvent({ name: 'NEVER', timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(4999);
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await waiting).toEqual({ event: null, timedOut: true, latestSeq: 0 });
    expect(onLogged).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('caps the wait below the bridge call timeout', async () => {
    vi.useFakeTimers();
    const { handlers } = setup();

    const waiting = handlers.waitForEvent({ name: 'NEVER', timeoutMs: 120_000 });
    await vi.advanceTimersByTimeAsync(25_000);

    expect(await waiting).toMatchObject({ timedOut: true });
  });

  it('stops serializing eagerly once the wait is over', async () => {
    const serialize = vi.fn(serializeToJson);
    const store = createTimelineStore({ serialize });
    const handlers = createTimelineAgentHandlers(() => store);

    const waiting = handlers.waitForEvent({ name: 'HIT' });
    store.log({ channel: 'c', name: 'HIT', payload: { n: 1 } });
    await waiting;
    expect(serialize).toHaveBeenCalledTimes(1);

    // No listener left and no panel attached: back to a plain buffer push.
    store.log({ channel: 'c', name: 'LATER', payload: { big: true } });
    expect(serialize).toHaveBeenCalledTimes(1);
  });
});

