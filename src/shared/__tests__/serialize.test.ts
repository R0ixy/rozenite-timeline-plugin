import { describe, expect, it } from 'vitest';
import {
  serializeToJson,
  utf8Length,
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

describe('serializeToJson', () => {
  const viaSafeSerialize = (value: unknown) => JSON.stringify(safeSerialize(value).value);

  it('encodes plain JSON exactly like the careful path', () => {
    const plain = { a: 1, b: 'two', c: [true, null, { d: 3.5, e: [] }], f: {} };

    expect(serializeToJson(plain)).toEqual({ json: viaSafeSerialize(plain), truncated: false });
    expect(serializeToJson('text')).toEqual({ json: '"text"', truncated: false });
    expect(serializeToJson(null)).toEqual({ json: 'null', truncated: false });
  });

  it('falls back to the careful path for anything native JSON would get wrong', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const cases: unknown[] = [
      cyclic,
      { error: new Error('boom') },
      { when: new Date(0) },
      { map: new Map([['k', 1]]) },
      { set: new Set([1]) },
      { big: 10n },
      { fn: () => {} },
      { missing: undefined, kept: 1 },
      { nan: Number.NaN },
      [1, undefined, 3],
      { custom: { toJSON: () => 'custom' } },
      new (class Point {
        x = 1;
      })(),
    ];

    for (const value of cases) {
      expect(serializeToJson(value).json).toBe(viaSafeSerialize(value));
    }
  });

  it('applies the size limits and reports truncation', () => {
    const { json, truncated } = serializeToJson({ blob: 'z'.repeat(50_000) }, { maxStringLength: 100 });

    expect(truncated).toBe(true);
    expect(json).toContain('[truncated 49900 chars]');
  });

  it('survives a throwing getter on a plain object', () => {
    const hostile = Object.defineProperty({ ok: 1 }, 'boom', {
      enumerable: true,
      get: () => {
        throw new Error('nope');
      },
    });

    expect(JSON.parse(serializeToJson(hostile).json)).toEqual({ ok: 1, boom: '[Throws: nope]' });
  });

  it('keeps objects with undefined fields on the same output as the careful path', () => {
    const value = { userId: 'u1', coupon: undefined, nested: { a: undefined, b: 1 } };

    expect(serializeToJson(value)).toEqual({ json: '{"userId":"u1","nested":{"b":1}}', truncated: false });
    expect(serializeToJson(value).json).toBe(viaSafeSerialize(value));
  });

  it('keeps an own __proto__ key on both paths', () => {
    const plain = JSON.parse('{"__proto__":{"x":1},"a":1}');
    const withDate = Object.assign(JSON.parse('{"__proto__":{"x":1},"a":1}'), { when: new Date(0) });

    expect(JSON.parse(serializeToJson(plain).json)).toEqual(plain);
    expect(serializeToJson(withDate).json).toBe(
      '{"__proto__":{"x":1},"a":1,"when":"1970-01-01T00:00:00.000Z"}',
    );
  });

  describe('size cap', () => {
    const bytesOf = (text: string) => new TextEncoder().encode(text).length;

    it('counts UTF-8 bytes like the platform encoder', () => {
      for (const text of ['ascii', 'é', '漢字', '😀 emoji', '\u0000', 'mixed é漢😀a', '\ud800']) {
        expect(utf8Length(text)).toBe(bytesOf(text));
      }
    });

    it('caps payloads whose escapes or characters grow in encoding', () => {
      const cases = {
        nullChars: Array.from({ length: 6 }, () => '\u0000'.repeat(10_000)),
        quotes: Array.from({ length: 6 }, () => '"'.repeat(10_000)),
        cjk: Array.from({ length: 6 }, () => '漢'.repeat(10_000)),
        emoji: Array.from({ length: 6 }, () => '😀'.repeat(5_000)),
        slowPath: { when: new Date(0), strings: Array.from({ length: 6 }, () => '\u0000'.repeat(10_000)) },
      };

      for (const value of Object.values(cases)) {
        const { json, truncated } = serializeToJson(value);
        expect(truncated).toBe(true);
        expect(bytesOf(json)).toBeLessThanOrEqual(64 * 1024);
        expect(() => JSON.parse(json)).not.toThrow();
      }
    });

    it('leaves payloads within the cap untouched', () => {
      const value = { text: 'a'.repeat(10_000), cjk: '漢'.repeat(5_000) };

      expect(serializeToJson(value)).toEqual({ json: JSON.stringify(value), truncated: false });
    });

    it('holds for small custom caps', () => {
      const value = { rows: Array.from({ length: 50 }, (_, index) => ({ index, label: `ラベル ${index}` })) };

      for (const maxBytes of [64, 256, 1000]) {
        const { json, truncated } = serializeToJson(value, { maxBytes });
        expect(truncated).toBe(true);
        expect(bytesOf(json)).toBeLessThanOrEqual(maxBytes);
      }
    });
  });
});

