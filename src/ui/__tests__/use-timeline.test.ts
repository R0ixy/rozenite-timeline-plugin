import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '../../shared/types';
import { initialTimelineState, timelineReducer, type TimelineState } from '../use-timeline';

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

const reduce = (state: TimelineState, ...actions: Parameters<typeof timelineReducer>[1][]) =>
  actions.reduce(timelineReducer, state);

describe('timelineReducer', () => {
  it('replaces events on snapshot and marks the app connected', () => {
    const state = reduce(
      initialTimelineState,
      { type: 'events', events: [makeEvent()] },
      { type: 'snapshot', events: [makeEvent('a'), makeEvent('b')], maxEvents: 10 },
    );

    expect(state.status).toBe('connected');
    expect(state.events.map((event) => event.channel)).toEqual(['a', 'b']);
    expect(state.channels).toEqual(['c', 'a', 'b']);
  });

  it('keeps at most maxEvents, dropping the oldest', () => {
    const state = reduce(
      initialTimelineState,
      { type: 'snapshot', events: [makeEvent(), makeEvent()], maxEvents: 3 },
      { type: 'events', events: [makeEvent(), makeEvent()] },
    );

    expect(state.events).toHaveLength(3);
    expect(state.events[0].seq).toBeGreaterThan(seq - 3);
  });

  it('holds events while paused and appends them on resume', () => {
    const paused = reduce(
      initialTimelineState,
      { type: 'snapshot', events: [makeEvent()], maxEvents: 10 },
      { type: 'set-paused', paused: true },
      { type: 'events', events: [makeEvent('late')] },
    );

    expect(paused.events).toHaveLength(1);
    expect(paused.held).toHaveLength(1);
    expect(paused.channels).toContain('late');

    const resumed = reduce(paused, { type: 'set-paused', paused: false });
    expect(resumed.events).toHaveLength(2);
    expect(resumed.held).toEqual([]);
  });

  it('clears events but remembers channels for the filter', () => {
    const state = reduce(
      initialTimelineState,
      { type: 'snapshot', events: [makeEvent('analytics')], maxEvents: 10 },
      { type: 'cleared' },
    );

    expect(state.events).toEqual([]);
    expect(state.channels).toEqual(['analytics']);
  });
});
