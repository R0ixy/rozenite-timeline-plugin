import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeToJson } from '../../shared/serialize';
import type { TimelineEvent } from '../../shared/types';
import { createTimelineStore, type TimelineSnapshotChunk, type TimelineSink } from '../store';

const createSink = () => {
  const snapshots: TimelineSnapshotChunk[] = [];
  const batches: TimelineEvent[][] = [];
  const sink: TimelineSink & { cleared: number } = {
    cleared: 0,
    onSnapshot: (chunk) => {
      snapshots.push(chunk);
    },
    onEvents: (events) => {
      batches.push(events);
    },
    onCleared: () => {
      sink.cleared += 1;
    },
  };
  /** Every event received, snapshot chunks then live, in arrival order. */
  const names = () => [...snapshots.flatMap((chunk) => chunk.events), ...batches.flat()].map((e) => e.name);
  return { sink, snapshots, batches, names };
};

/** Runs replay chunks on demand instead of on a timer. */
const createScheduler = () => {
  const queue: (() => void)[] = [];
  return {
    schedule: (callback: () => void) => {
      queue.push(callback);
    },
    runAll: () => {
      while (queue.length > 0) {
        queue.shift()?.();
      }
    },
    get pending() {
      return queue.length;
    },
  };
};

const logAll = (store: ReturnType<typeof createTimelineStore>, names: string[]) =>
  names.forEach((name) => store.log({ channel: 'c', name, payload: { name } }));

describe('timeline store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('adds id, timestamp, sequence and defaults to every event', () => {
    let now = 1_000;
    const store = createTimelineStore({ now: () => now++ });

    store.log({ channel: 'analytics', name: 'EVENT' });
    store.log({
      channel: 'auth',
      name: 'LOGIN',
      preview: 'ok',
      level: 'warn',
      important: true,
      tags: ['sso'],
    });

    const [first, second] = store.getEvents();
    expect(first).toEqual({
      id: expect.any(String),
      seq: 1,
      timestamp: 1000,
      channel: 'analytics',
      name: 'EVENT',
      level: 'info',
      important: false,
      tags: [],
    });
    expect(second).toMatchObject({
      seq: 2,
      timestamp: 1001,
      channel: 'auth',
      preview: 'ok',
      level: 'warn',
      important: true,
      tags: ['sso'],
    });
    expect(first.id).not.toBe(second.id);
  });

  it('coerces sloppy input instead of throwing', () => {
    const store = createTimelineStore();

    expect(() => {
      store.log(undefined as never);
      store.log({ channel: 42, name: null, level: 'loud', tags: 'x', preview: 7 } as never);
    }).not.toThrow();

    expect(store.getEvents()).toEqual([
      expect.objectContaining({ channel: 'default', name: 'EVENT', level: 'info', tags: [] }),
      expect.objectContaining({ channel: 'default', name: 'EVENT', level: 'info', preview: '7' }),
    ]);
  });

  it('only pushes to the ring buffer while no panel is attached', () => {
    const serialize = vi.fn(serializeToJson);
    const store = createTimelineStore({ maxEvents: 3, serialize });

    for (let index = 0; index < 5; index += 1) {
      store.log({ channel: 'c', name: `E${index}`, payload: { index } });
    }
    vi.runAllTimers();

    // Nothing serialized, nothing scheduled: the payloads are only referenced.
    expect(serialize).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(store.size).toBe(3);
    expect(store.getEvents()[0].payloadJson).toBe('{"index":2}');
  });

  it('replays the buffer on attach, then sends each event synchronously', () => {
    const store = createTimelineStore({ maxEvents: 3 });
    logAll(store, ['a', 'b', 'c', 'd']);

    const { sink, snapshots, batches } = createSink();
    store.attach(sink);

    expect(snapshots).toEqual([
      expect.objectContaining({ reset: true, done: true, maxEvents: 3, sessionKey: expect.any(String) }),
    ]);
    expect(snapshots[0].events.map((event) => event.name)).toEqual(['b', 'c', 'd']);
    expect(snapshots[0].events[0].payloadJson).toBe('{"name":"b"}');
    expect(store.isLive).toBe(true);

    // No timer between log() and the sink: each event goes out in the call.
    store.log({ channel: 'c', name: 'e', payload: { n: 1 } });
    expect(batches.map((batch) => batch.map((event) => event.name))).toEqual([['e']]);
    store.log({ channel: 'c', name: 'f' });
    expect(batches.map((batch) => batch.map((event) => event.name))).toEqual([['e'], ['f']]);
    expect(batches[0][0].payloadJson).toBe('{"n":1}');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('replays a large buffer in chunks, yielding between them, without losing or reordering events', () => {
    const scheduler = createScheduler();
    const store = createTimelineStore({ maxEvents: 1000, chunkEvents: 100, schedule: scheduler.schedule });
    logAll(store, Array.from({ length: 250 }, (_, index) => `E${index}`));

    const { sink, snapshots, batches, names } = createSink();
    store.attach(sink);

    // Only the first chunk ran synchronously.
    expect(snapshots.map((chunk) => [chunk.events.length, chunk.reset, chunk.done])).toEqual([[100, true, false]]);
    expect(store.isLive).toBe(false);

    // Logged mid-replay: buffered, not streamed, and picked up by a later chunk.
    store.log({ channel: 'c', name: 'during' });
    expect(batches).toEqual([]);

    scheduler.runAll();
    expect(snapshots.map((chunk) => [chunk.events.length, chunk.reset, chunk.done])).toEqual([
      [100, true, false],
      [100, false, false],
      [51, false, true],
    ]);
    expect(store.isLive).toBe(true);

    store.log({ channel: 'c', name: 'after' });
    expect(names()).toEqual([...Array.from({ length: 250 }, (_, index) => `E${index}`), 'during', 'after']);
  });

  it('closes a chunk early when its payloads get large', () => {
    const scheduler = createScheduler();
    const store = createTimelineStore({ chunkEvents: 100, chunkBytes: 1000, schedule: scheduler.schedule });
    for (let index = 0; index < 5; index += 1) {
      store.log({ channel: 'c', name: `E${index}`, payload: 'x'.repeat(600) });
    }

    const { sink, snapshots } = createSink();
    store.attach(sink);
    scheduler.runAll();

    expect(snapshots.map((chunk) => chunk.events.length)).toEqual([2, 2, 1]);
  });

  it('resumes after the last event the panel has, from the same session', () => {
    const store = createTimelineStore();
    logAll(store, ['a', 'b']);
    const first = createSink();
    store.attach(first.sink);
    const { sessionKey } = first.snapshots[0];
    store.detach(first.sink);

    logAll(store, ['c', 'd']);
    const second = createSink();
    store.attach(second.sink, { sessionKey, afterSeq: 2 });

    expect(second.snapshots).toEqual([expect.objectContaining({ reset: false, done: true })]);
    expect(second.names()).toEqual(['c', 'd']);
  });

  it('falls back to a full replay when the resume point is gone', () => {
    const store = createTimelineStore({ maxEvents: 2 });
    logAll(store, ['a', 'b']);
    const first = createSink();
    store.attach(first.sink);
    const { sessionKey } = first.snapshots[0];
    store.detach(first.sink);

    // Three new events into a buffer of two: 'c' is evicted before the panel saw it.
    logAll(store, ['c', 'd', 'e']);
    const afterEviction = createSink();
    store.attach(afterEviction.sink, { sessionKey, afterSeq: 2 });
    expect(afterEviction.snapshots[0].reset).toBe(true);
    expect(afterEviction.names()).toEqual(['d', 'e']);

    // A different session (another app run) or a cleared buffer also resets.
    const otherSession = createSink();
    store.attach(otherSession.sink, { sessionKey: 'someone-else', afterSeq: 5 });
    expect(otherSession.snapshots[0].reset).toBe(true);

    store.clear();
    logAll(store, ['f']);
    const afterClear = createSink();
    store.attach(afterClear.sink, { sessionKey, afterSeq: 5 });
    expect(afterClear.snapshots[0]).toMatchObject({ reset: true });
    expect(afterClear.snapshots[0].sessionKey).not.toBe(sessionKey);
    expect(afterClear.names()).toEqual(['f']);
  });

  it('snapshots the payload at log time while a panel is live', () => {
    const store = createTimelineStore();
    const { sink, batches } = createSink();
    store.attach(sink);
    const payload = { count: 1 };

    store.log({ channel: 'c', name: 'E', payload });
    payload.count = 2;

    expect(batches[0][0].payloadJson).toBe('{"count":1}');
    expect(store.getEvents()[0].payloadJson).toBe('{"count":1}');
  });

  it('serializes each payload once, however often it is read', () => {
    const serialize = vi.fn(serializeToJson);
    const store = createTimelineStore({ serialize });
    store.log({ channel: 'c', name: 'E', payload: { nested: { value: 1 } } });

    store.attach(createSink().sink);
    store.getEvents();
    store.getEvents();

    expect(serialize).toHaveBeenCalledTimes(1);
  });

  it('marks truncated payloads', () => {
    const store = createTimelineStore({ serializeOptions: { maxBytes: 100 } });
    store.log({ channel: 'c', name: 'BIG', payload: { blob: 'z'.repeat(10_000) } });

    expect(store.getEvents()[0].truncated).toBe(true);
  });

  it('stops streaming after detach and cancels a replay in progress', () => {
    const scheduler = createScheduler();
    const store = createTimelineStore({ chunkEvents: 1, schedule: scheduler.schedule });
    logAll(store, ['a', 'b', 'c']);
    const { sink, names } = createSink();
    store.attach(sink);

    store.detach(sink);
    scheduler.runAll();
    store.log({ channel: 'c', name: 'd' });

    expect(names()).toEqual(['a']);
    expect(store.isAttached).toBe(false);
  });

  it('ignores a detach for a sink that is no longer current', () => {
    const store = createTimelineStore();
    const stale = createSink();
    const current = createSink();
    store.attach(stale.sink);
    store.attach(current.sink);

    store.detach(stale.sink);
    expect(store.isAttached).toBe(true);
  });

  it('detaches instead of throwing into the app when the bridge fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createTimelineStore();
    const { sink } = createSink();
    store.attach(sink);
    sink.onEvents = () => {
      throw new Error('bridge down');
    };

    expect(() => store.log({ channel: 'c', name: 'E' })).not.toThrow();
    expect(store.isAttached).toBe(false);
    // The event is still in the buffer for the next panel.
    expect(store.getEvents().map((event) => event.name)).toEqual(['E']);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('clears the buffer and notifies the panel', () => {
    const store = createTimelineStore();
    const { sink } = createSink();
    store.attach(sink);
    store.log({ channel: 'c', name: 'a' });

    expect(store.clear()).toBe(1);

    expect(store.getEvents()).toEqual([]);
    expect(sink.cleared).toBe(1);
  });

  it('finds events by id', () => {
    const store = createTimelineStore();
    store.log({ channel: 'c', name: 'a', payload: [1] });
    const [event] = store.getEvents();
    expect(event.payloadJson).toBe('[1]');

    expect(store.getEvent(event.id)).toEqual(event);
    expect(store.getEvent('missing')).toBeUndefined();
  });

  it('applies a new maxEvents to the buffer', () => {
    const store = createTimelineStore({ maxEvents: 10 });
    for (let index = 0; index < 10; index += 1) {
      store.log({ channel: 'c', name: String(index) });
    }

    store.setMaxEvents(2);

    expect(store.maxEvents).toBe(2);
    expect(store.getEvents().map((event) => event.name)).toEqual(['8', '9']);
  });
});
