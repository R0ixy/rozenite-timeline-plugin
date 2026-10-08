import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '../../shared/types';
import { initialTimelineState, timelineReducer, type TimelineAction, type TimelineState } from '../use-timeline';

let seq = 0;
const makeEvent = (channel = 'c'): TimelineEvent => {
  seq += 1;
  return {
    id: `e${seq}`,
    seq,
    timestamp: seq,
    channel,
    name: `E${seq}`,
    level: 'info',
    important: false,
    tags: [],
  };
};

const snapshot = (
  events: TimelineEvent[],
  overrides: Partial<Extract<TimelineAction, { type: 'snapshot' }>> = {},
): TimelineAction => ({
  type: 'snapshot',
  sessionKey: 'app:0',
  maxEvents: 10,
  reset: true,
  done: true,
  events,
  ...overrides,
});

const reduce = (state: TimelineState, ...actions: TimelineAction[]) => actions.reduce(timelineReducer, state);
const seqs = (state: TimelineState) => state.events.map((event) => event.seq);

describe('timelineReducer', () => {
  it('ignores live events until the first snapshot, then replaces on a reset', () => {
    const [a, b, c] = [makeEvent('a'), makeEvent('b'), makeEvent('c')];
    const state = reduce(initialTimelineState, { type: 'events', events: [a] }, snapshot([b, c]));

    expect(state.status).toBe('connected');
    expect(seqs(state)).toEqual([b.seq, c.seq]);
    expect(state.channels).toEqual(['b', 'c']);
    expect(state.sessionKey).toBe('app:0');
    expect(state.lastSeq).toBe(c.seq);
  });

  it('appends chunks and live events, dropping duplicates by seq', () => {
    const [a, b, c, d] = [makeEvent(), makeEvent(), makeEvent(), makeEvent()];
    const state = reduce(
      initialTimelineState,
      snapshot([a, b], { done: false }),
      snapshot([c], { reset: false }),
      { type: 'events', events: [d] },
      // A lease renewal raced with the live send of `d`.
      snapshot([d], { reset: false }),
      { type: 'events', events: [c] },
    );

    expect(seqs(state)).toEqual([a.seq, b.seq, c.seq, d.seq]);
    expect(state.lastSeq).toBe(d.seq);
  });

  it('replaces everything when the snapshot comes from another session', () => {
    const [a, b] = [makeEvent(), makeEvent()];
    const restarted = makeEvent();
    restarted.seq = 1;
    const state = reduce(
      initialTimelineState,
      snapshot([a, b]),
      snapshot([restarted], { sessionKey: 'app-restarted:0', reset: false }),
    );

    expect(state.events).toEqual([restarted]);
    expect(state.lastSeq).toBe(1);
  });

  it('keeps at most maxEvents, dropping the oldest', () => {
    const events = Array.from({ length: 5 }, () => makeEvent());
    const state = reduce(initialTimelineState, snapshot(events.slice(0, 2), { maxEvents: 3 }), {
      type: 'events',
      events: events.slice(2),
    });

    expect(seqs(state)).toEqual(events.slice(2).map((event) => event.seq));
  });

  it('ignores whatever is still in flight while paused; resuming refetches it', () => {
    const [a, b, c] = [makeEvent(), makeEvent(), makeEvent()];
    const paused = reduce(
      initialTimelineState,
      snapshot([a]),
      { type: 'set-paused', paused: true },
      { type: 'events', events: [b] },
      snapshot([c]),
    );

    expect(seqs(paused)).toEqual([a.seq]);
    // The resume point still points after `a`, so the app sends `b` and `c`.
    expect(paused.lastSeq).toBe(a.seq);

    const resumed = reduce(paused, { type: 'set-paused', paused: false }, snapshot([b, c], { reset: false }));
    expect(seqs(resumed)).toEqual([a.seq, b.seq, c.seq]);
  });

  it('clears events but remembers channels for the filter', () => {
    const state = reduce(initialTimelineState, snapshot([makeEvent('analytics')]), { type: 'cleared' });

    expect(state.events).toEqual([]);
    expect(state.channels).toEqual(['analytics']);
  });
});
