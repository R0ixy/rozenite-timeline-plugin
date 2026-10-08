import type { RozeniteDevToolsClient } from '@rozenite/plugin-bridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMELINE_LEASE_MS, type TimelineEventMap } from '../../shared/messaging';
import { createTimelineStore } from '../store';
import { connectTimelineToClient } from '../useRozeniteTimelinePlugin';

type Sent = { type: keyof TimelineEventMap; payload: unknown };

/** A synchronous stand-in for the bridge client, so fake timers stay in control. */
const createFakeClient = () => {
  const handlers = new Map<string, (payload: unknown) => void>();
  const sent: Sent[] = [];
  const client = {
    send: vi.fn((type: keyof TimelineEventMap, payload: unknown) => {
      sent.push({ type, payload });
    }),
    onMessage: (type: string, handler: (payload: unknown) => void) => {
      handlers.set(type, handler);
      return { remove: () => handlers.delete(type) };
    },
    close: () => {},
  };
  const receive = <T extends keyof TimelineEventMap>(type: T, payload: TimelineEventMap[T]) =>
    handlers.get(type)?.(payload);
  return {
    client: client as unknown as RozeniteDevToolsClient<TimelineEventMap>,
    raw: client,
    sent,
    receive,
    sentOf: (type: keyof TimelineEventMap) => sent.filter((message) => message.type === type),
    lastOf: (type: keyof TimelineEventMap) => {
      const matching = sent.filter((message) => message.type === type);
      return matching[matching.length - 1]?.payload;
    },
  };
};

describe('connectTimelineToClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('announces itself, then streams after hello', () => {
    const store = createTimelineStore();
    const fake = createFakeClient();
    connectTimelineToClient(fake.client, store);

    expect(fake.sentOf('device-ready')).toEqual([{ type: 'device-ready', payload: { maxEvents: 1000 } }]);

    fake.receive('hello', {});
    store.log({ channel: 'c', name: 'E' });

    expect(fake.sentOf('snapshot')).toHaveLength(1);
    expect(fake.sentOf('events')).toHaveLength(1);
  });

  it('stops streaming when the lease runs out, and a renewal resumes without gaps', () => {
    const store = createTimelineStore();
    const fake = createFakeClient();
    connectTimelineToClient(fake.client, store);
    fake.receive('hello', {});
    const { sessionKey } = fake.sentOf('snapshot')[0].payload as { sessionKey: string };

    // A renewal inside the lease keeps it going.
    vi.advanceTimersByTime(TIMELINE_LEASE_MS - 1);
    fake.receive('hello', { sessionKey, afterSeq: 0 });
    vi.advanceTimersByTime(TIMELINE_LEASE_MS - 1);
    expect(store.isAttached).toBe(true);

    // The panel vanished without `bye`: the app goes back to buffering.
    vi.advanceTimersByTime(1);
    expect(store.isAttached).toBe(false);
    store.log({ channel: 'c', name: 'while-away' });
    expect(fake.sentOf('events')).toHaveLength(0);

    // The panel was only throttled; its next renewal fetches what it missed.
    fake.receive('hello', { sessionKey, afterSeq: 0 });
    const last = fake.lastOf('snapshot') as { reset: boolean; events: { name: string }[] };
    expect(last.reset).toBe(false);
    expect(last.events.map((event) => event.name)).toEqual(['while-away']);
  });

  it('pauses on bye and resumes with only the newer events', () => {
    const store = createTimelineStore();
    const fake = createFakeClient();
    connectTimelineToClient(fake.client, store);
    store.log({ channel: 'c', name: 'before' });
    fake.receive('hello', {});
    const { sessionKey } = fake.sentOf('snapshot')[0].payload as { sessionKey: string };

    fake.receive('bye', {});
    store.log({ channel: 'c', name: 'paused-1' });
    store.log({ channel: 'c', name: 'paused-2' });
    expect(fake.sentOf('events')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);

    fake.receive('hello', { sessionKey, afterSeq: 1 });
    const resumed = fake.lastOf('snapshot') as { events: { name: string }[] };
    expect(resumed.events.map((event) => event.name)).toEqual(['paused-1', 'paused-2']);
  });

  it('never lets a handler throw into the app', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createTimelineStore();
    const fake = createFakeClient();
    connectTimelineToClient(fake.client, store);
    vi.spyOn(store, 'attach').mockImplementation(() => {
      throw new Error('boom');
    });
    vi.spyOn(store, 'clear').mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => fake.receive('hello', {})).not.toThrow();
    expect(() => fake.receive('clear', {})).not.toThrow();
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('stops everything on disconnect', () => {
    const store = createTimelineStore();
    const fake = createFakeClient();
    const disconnect = connectTimelineToClient(fake.client, store);
    fake.receive('hello', {});

    disconnect();

    expect(store.isAttached).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
