import { describe, expect, it } from 'vitest';
import {
  CIRCULAR_MARKER,
  MAX_DEPTH_MARKER,
  safeSerialize,
  TRUNCATED_KEY,
  TRUNCATED_MARKER,
} from '../serialize';

describe('safeSerialize', () => {
  it('passes plain JSON through untouched', () => {
    const value = { a: 1, b: 'two', c: [true, null, { d: 3.5 }] };

    expect(safeSerialize(value)).toEqual({ value, truncated: false });
  });

  it('breaks cycles but keeps shared references', () => {
    const shared = { id: 1 };
    const node: Record<string, unknown> = { name: 'root', left: shared, right: shared };
    node.self = node;
    const list: unknown[] = [1];
    list.push(list);

    const { value } = safeSerialize({ node, list });

    expect(value).toEqual({
      node: { name: 'root', left: { id: 1 }, right: { id: 1 }, self: CIRCULAR_MARKER },
      list: [1, CIRCULAR_MARKER],
    });
  });

  it('turns Errors into { name, message, stack } with cause and custom fields', () => {
    const cause = new TypeError('socket closed');
    const error = Object.assign(new Error('request failed'), { cause, code: 'E_NET' });

    const { value } = safeSerialize({ error });
    const serialized = (value as { error: Record<string, unknown> }).error;

    expect(serialized.name).toBe('Error');
    expect(serialized.message).toBe('request failed');
    expect(serialized.stack).toEqual(expect.stringContaining('request failed'));
    expect(serialized.code).toBe('E_NET');
    expect(serialized.cause).toMatchObject({ name: 'TypeError', message: 'socket closed' });
  });

  it('describes functions, dates, maps, sets, bigints, symbols and binary data', () => {
    function track() {}
    const { value, truncated } = safeSerialize({
      fn: track,
      anonymous: (() => () => {})(),
      date: new Date('2026-01-02T03:04:05.000Z'),
      invalidDate: new Date(Number.NaN),
      map: new Map<unknown, unknown>([
        ['a', 1],
        [{ k: 1 }, 'object key'],
      ]),
      set: new Set([1, 'x']),
      big: 12345678901234567890n,
      sym: Symbol('s'),
      bytes: new Uint8Array(16),
      notANumber: Number.NaN,
      regex: /ab+c/gi,
      missing: undefined,
    });

    expect(truncated).toBe(false);
    expect(value).toEqual({
      fn: '[Function: track]',
      anonymous: '[Function]',
      date: '2026-01-02T03:04:05.000Z',
      invalidDate: 'Invalid Date',
      map: {
        __type: 'Map',
        size: 2,
        entries: [
          ['a', 1],
          [{ k: 1 }, 'object key'],
        ],
      },
      set: { __type: 'Set', size: 2, values: [1, 'x'] },
      big: '12345678901234567890n',
      sym: 'Symbol(s)',
      bytes: '[Uint8Array(16 bytes)]',
      notANumber: 'NaN',
      regex: '/ab+c/gi',
    });
  });

  it('survives throwing getters and toJSON', () => {
    const hostile = {
      ok: 1,
      get boom() {
        throw new Error('nope');
      },
    };
    const badToJson = { toJSON: () => {
      throw new Error('bad toJSON');
    } };

    const { value } = safeSerialize({ hostile, badToJson });

    expect(value).toEqual({
      hostile: { ok: 1, boom: '[Throws: nope]' },
      badToJson: '[Throws: bad toJSON]',
    });
  });

  it('never throws, even for a hostile Proxy', () => {
    const proxy = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('trap');
        },
      },
    );

    expect(() => safeSerialize(proxy)).not.toThrow();
    expect(safeSerialize(proxy).truncated).toBe(true);
  });

  it('truncates long strings with a visible marker', () => {
    const { value, truncated } = safeSerialize('x'.repeat(50), { maxStringLength: 10 });

    expect(truncated).toBe(true);
    expect(value).toBe(`${'x'.repeat(10)}… [truncated 40 chars]`);
  });

  it('caps the total payload size and marks what was cut', () => {
    const huge = Array.from({ length: 2000 }, (_, index) => ({ index, text: 'y'.repeat(100) }));

    const { value, truncated } = safeSerialize({ huge }, { maxBytes: 4 * 1024 });
    const json = JSON.stringify(value);

    expect(truncated).toBe(true);
    expect(json.length).toBeLessThan(8 * 1024);
    expect(json).toContain(TRUNCATED_MARKER);
  });

  it('caps entries per object and per array', () => {
    const wide = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`k${index}`, index]));

    const { value, truncated } = safeSerialize(
      { wide, long: Array.from({ length: 10 }, (_, index) => index) },
      { maxEntries: 3 },
    );

    expect(truncated).toBe(true);
    expect(value).toEqual({
      wide: { k0: 0, k1: 1, k2: 2, [TRUNCATED_KEY]: '7 more keys' },
      long: [0, 1, 2, `${TRUNCATED_MARKER} 7 more items`],
    });
  });

  it('stops at the depth limit', () => {
    const deep = { a: { b: { c: { d: 1 } } } };

    const { value, truncated } = safeSerialize(deep, { maxDepth: 2 });

    expect(truncated).toBe(true);
    expect(value).toEqual({ a: { b: MAX_DEPTH_MARKER } });
  });

  it('produces values that survive a JSON round trip', () => {
    const cyclic: Record<string, unknown> = { when: new Date(0), err: new Error('x') };
    cyclic.again = cyclic;

    const { value } = safeSerialize(cyclic);

    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });
});
