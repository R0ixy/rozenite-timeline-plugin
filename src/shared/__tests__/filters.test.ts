import { describe, expect, it } from 'vitest';
import { filterEvents, summarizeChannels } from '../filters';
import type { TimelineEvent } from '../types';

let seq = 0;
const makeEvent = (overrides: Partial<TimelineEvent>): TimelineEvent => {
  seq += 1;
  return {
    id: `e-${seq}`,
    seq,
    timestamp: 1000 * seq,
    channel: 'analytics',
    name: 'EVENT',
    level: 'info',
    important: false,
    tags: [],
    ...overrides,
  };
};

const events = [
  makeEvent({ channel: 'analytics', name: 'EVENT', preview: 'checkout_started', timestamp: 1000 }),
  makeEvent({ channel: 'analytics', name: 'SCREEN', preview: 'Home', timestamp: 2000 }),
  makeEvent({
    channel: 'flags',
    name: 'EVALUATE',
    preview: 'new-onboarding',
    payloadJson: JSON.stringify({ value: true, source: 'remote' }),
    level: 'debug',
    timestamp: 3000,
  }),
  makeEvent({ channel: 'auth', name: 'LOGIN_FAILED', level: 'error', tags: ['sso'], timestamp: 4000 }),
  makeEvent({ channel: 'auth', name: 'TOKEN_REFRESH', level: 'warn', timestamp: 5000 }),
];

const names = (result: TimelineEvent[]) => result.map((event) => event.name);

describe('filterEvents', () => {
  it('returns everything for an empty filter', () => {
    expect(filterEvents(events, {})).toHaveLength(events.length);
    expect(filterEvents(events, { channels: [], levels: [], search: '  ' })).toHaveLength(
      events.length,
    );
  });

  it('filters by any of several channels', () => {
    expect(names(filterEvents(events, { channels: ['flags', 'auth'] }))).toEqual([
      'EVALUATE',
      'LOGIN_FAILED',
      'TOKEN_REFRESH',
    ]);
  });

  it('filters by level', () => {
    expect(names(filterEvents(events, { levels: ['warn', 'error'] }))).toEqual([
      'LOGIN_FAILED',
      'TOKEN_REFRESH',
    ]);
  });

  it('searches name, preview, tags and payload, case-insensitively', () => {
    expect(names(filterEvents(events, { search: 'screen' }))).toEqual(['SCREEN']);
    expect(names(filterEvents(events, { search: 'CHECKOUT' }))).toEqual(['EVENT']);
    expect(names(filterEvents(events, { search: 'sso' }))).toEqual(['LOGIN_FAILED']);
    expect(names(filterEvents(events, { search: '"source":"remote"' }))).toEqual(['EVALUATE']);
    expect(filterEvents(events, { search: 'nothing-matches' })).toEqual([]);
  });

  it('filters by time', () => {
    expect(names(filterEvents(events, { since: 4000 }))).toEqual(['LOGIN_FAILED', 'TOKEN_REFRESH']);
  });

  it('combines filters with AND', () => {
    expect(
      names(filterEvents(events, { channels: ['auth'], levels: ['error'], search: 'login' })),
    ).toEqual(['LOGIN_FAILED']);
    expect(filterEvents(events, { channels: ['analytics'], levels: ['error'] })).toEqual([]);
  });
});

describe('summarizeChannels', () => {
  it('counts events per channel in first-seen order', () => {
    expect(summarizeChannels(events)).toEqual([
      { channel: 'analytics', count: 2, lastTimestamp: 2000 },
      { channel: 'flags', count: 1, lastTimestamp: 3000 },
      { channel: 'auth', count: 2, lastTimestamp: 5000 },
    ]);
  });
});
