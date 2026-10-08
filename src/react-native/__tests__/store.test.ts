import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeToJson } from '../../shared/serialize';
import type { TimelineEvent } from '../../shared/types';
import { createTimelineStore, type TimelineSink } from '../store';

const createSink = () => {
  const batches: TimelineEvent[][] = [];
  const sink: TimelineSink & { cleared: number } = {
    cleared: 0,
    onEvents: (events) => batches.push(events),
    onCleared: () => {
      sink.cleared += 1;
    },
  };
  return { sink, batches };
};

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
    expect(store.getEvents()[0].payloadJson).toBe('{"index":2}');
    expect(store.size).toBe(3);
  });

  it('returns the buffered events on attach and then sends each event synchronously', () => {
    const store = createTimelineStore({ maxEvents: 3 });
    ['a', 'b', 'c', 'd'].forEach((name) => store.log({ channel: 'c', name, payload: { name } }));

    const { sink, batches } = createSink();
    const snapshot = store.attach(sink);

    expect(snapshot.map((event) => event.name)).toEqual(['b', 'c', 'd']);
    expect(snapshot[0].payloadJson).toBe('{"name":"b"}');

    // No timer between log() and the sink: each event goes out in the call.
    store.log({ channel: 'c', name: 'e', payload: { n: 1 } });
    expect(batches.map((batch) => batch.map((event) => event.name))).toEqual([['e']]);
    store.log({ channel: 'c', name: 'f' });
    expect(batches.map((batch) => batch.map((event) => event.name))).toEqual([['e'], ['f']]);
    expect(batches[0][0].payloadJson).toBe('{"n":1}');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('snapshots the payload at log time while a panel is attached', () => {
    const store = createTimelineStore();
    const { sink, batches } = createSink();
    store.attach(sink);
    const payload = { count: 1 };

    store.log({ channel: 'c', name: 'E', payload });
    payload.count = 2;

    expect(batches[0][0].payloadJson).toBe('{"count":1}');
    expect(store.getEvents()[0].payloadJson).toBe('{"count":1}');
  });

  it('serializes each payload once, at send time, and lets go of the original', () => {
    const serialize = vi.fn(serializeToJson);
    const store = createTimelineStore({ serialize });
    const payload = { nested: { value: 1 } };
    store.log({ channel: 'c', name: 'E', payload });

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

  it('stops streaming after detach and replays everything on the next attach', () => {
    const store = createTimelineStore();
    const first = createSink();
    store.attach(first.sink);
    store.log({ channel: 'c', name: 'a' });
    store.detach(first.sink);
    store.log({ channel: 'c', name: 'b' });

    expect(first.batches.map((batch) => batch[0].name)).toEqual(['a']);

    const second = createSink();
    expect(store.attach(second.sink).map((event) => event.name)).toEqual(['a', 'b']);
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
