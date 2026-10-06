import type { JsonValue } from './types';

export type SerializeOptions = {
  /** Approximate JSON size budget for the whole payload. @default 64 KiB */
  maxBytes?: number;
  /** Nesting below this depth is replaced by a marker. @default 12 */
  maxDepth?: number;
  /** Longer strings are cut and marked. @default 10_000 */
  maxStringLength?: number;
  /** Keys per object / items per array / entries per Map or Set. @default 500 */
  maxEntries?: number;
};

export type SerializeResult = {
  value: JsonValue;
  /** True when anything was cut to respect the limits above. */
  truncated: boolean;
};

export const DEFAULT_SERIALIZE_OPTIONS: Required<SerializeOptions> = {
  maxBytes: 64 * 1024,
  maxDepth: 12,
  maxStringLength: 10_000,
  maxEntries: 500,
};

export const TRUNCATED_MARKER = '[Truncated]';
export const CIRCULAR_MARKER = '[Circular]';
export const MAX_DEPTH_MARKER = '[Max depth]';
/** Key under which an object or array notes how many entries were dropped. */
export const TRUNCATED_KEY = '…truncated';

type State = {
  options: Required<SerializeOptions>;
  budget: number;
  truncated: boolean;
  /** Ancestors of the node being walked, so shared (non-cyclic) refs are kept. */
  ancestors: Set<object>;
};

const describeThrown = (error: unknown): string => {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return 'unknown error';
  }
};

const spend = (state: State, amount: number): boolean => {
  state.budget -= amount;
  if (state.budget < 0) {
    state.truncated = true;
    return false;
  }
  return true;
};

const serializeString = (state: State, value: string): JsonValue => {
  const { maxStringLength } = state.options;
  let result = value;
  if (result.length > maxStringLength) {
    state.truncated = true;
    result = `${result.slice(0, maxStringLength)}… [truncated ${value.length - maxStringLength} chars]`;
  }
  if (!spend(state, result.length + 2)) {
    return TRUNCATED_MARKER;
  }
  return result;
};

const getTypeName = (value: object): string => {
  try {
    const name = (value as { constructor?: { name?: unknown } }).constructor?.name;
    return typeof name === 'string' && name ? name : 'Object';
  } catch {
    return 'Object';
  }
};

const walk = (state: State, value: unknown, depth: number): JsonValue | undefined => {
  if (state.budget < 0) {
    return TRUNCATED_MARKER;
  }

  switch (typeof value) {
    case 'string':
      return serializeString(state, value);
    case 'number':
      spend(state, 8);
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      spend(state, 5);
      return value;
    case 'bigint':
      return serializeString(state, `${value.toString()}n`);
    case 'symbol':
      return serializeString(state, value.toString());
    case 'undefined':
      return undefined;
    case 'function': {
      const name = (value as { name?: string }).name;
      return serializeString(state, `[Function${name ? `: ${name}` : ''}]`);
    }
  }

  if (value === null) {
    spend(state, 4);
    return null;
  }

  const object = value as object;

  if (object instanceof Date) {
    const time = object.getTime();
    return serializeString(state, Number.isNaN(time) ? 'Invalid Date' : object.toISOString());
  }

  if (object instanceof RegExp) {
    return serializeString(state, object.toString());
  }

  if (ArrayBuffer.isView(object) || object instanceof ArrayBuffer) {
    const length =
      object instanceof ArrayBuffer ? object.byteLength : (object as ArrayBufferView).byteLength;
    return serializeString(state, `[${getTypeName(object)}(${length} bytes)]`);
  }

  if (state.ancestors.has(object)) {
    return serializeString(state, CIRCULAR_MARKER);
  }

  if (depth >= state.options.maxDepth) {
    state.truncated = true;
    return MAX_DEPTH_MARKER;
  }

  state.ancestors.add(object);
  try {
    return walkContainer(state, object, depth);
  } finally {
    state.ancestors.delete(object);
  }
};

const walkArray = (state: State, items: readonly unknown[], depth: number): JsonValue[] => {
  const { maxEntries } = state.options;
  const result: JsonValue[] = [];
  spend(state, 2);
  const limit = Math.min(items.length, maxEntries);
  for (let index = 0; index < limit; index += 1) {
    if (state.budget < 0) {
      result.push(`${TRUNCATED_MARKER} ${items.length - index} more items`);
      return result;
    }
    let item: unknown;
    try {
      item = items[index];
    } catch (error) {
      item = `[Throws: ${describeThrown(error)}]`;
    }
    const serialized = walk(state, item, depth + 1);
    result.push(serialized === undefined ? null : serialized);
    spend(state, 1);
  }
  if (items.length > limit) {
    state.truncated = true;
    result.push(`${TRUNCATED_MARKER} ${items.length - limit} more items`);
  }
  return result;
};

const walkEntries = (
  state: State,
  target: { [key: string]: JsonValue },
  entries: Iterable<[string, unknown]>,
  total: number,
  depth: number,
) => {
  const { maxEntries } = state.options;
  let written = 0;
  for (const [key, entryValue] of entries) {
    if (written >= maxEntries || state.budget < 0) {
      state.truncated = true;
      target[TRUNCATED_KEY] = `${total - written} more keys`;
      return;
    }
    if (!spend(state, key.length + 3)) {
      target[TRUNCATED_KEY] = `${total - written} more keys`;
      return;
    }
    const serialized = walk(state, entryValue, depth + 1);
    if (serialized !== undefined) {
      target[key] = serialized;
    }
    written += 1;
  }
};

const ownEntries = function* (object: object): Generator<[string, unknown]> {
  for (const key of Object.keys(object)) {
    let entryValue: unknown;
    try {
      entryValue = (object as Record<string, unknown>)[key];
    } catch (error) {
      entryValue = `[Throws: ${describeThrown(error)}]`;
    }
    yield [key, entryValue];
  }
};

const walkContainer = (state: State, object: object, depth: number): JsonValue => {
  if (Array.isArray(object)) {
    return walkArray(state, object, depth);
  }

  if (object instanceof Error) {
    const result: { [key: string]: JsonValue } = {};
    spend(state, 2);
    const entries: [string, unknown][] = [
      ['name', object.name],
      ['message', object.message],
      ['stack', object.stack],
      ...('cause' in object ? ([['cause', object.cause]] as [string, unknown][]) : []),
      // Custom fields such as `code` or `status` carry the useful bits of
      // many SDK errors.
      ...Array.from(ownEntries(object)).filter(
        ([key]) => key !== 'name' && key !== 'message' && key !== 'stack' && key !== 'cause',
      ),
    ];
    walkEntries(state, result, entries, entries.length, depth);
    return result;
  }

  if (object instanceof Map) {
    spend(state, 30);
    const entries = Array.from(object.entries(), ([key, entryValue]) => [key, entryValue]);
    return {
      __type: 'Map',
      size: object.size,
      entries: walkArray(state, entries, depth),
    };
  }

  if (object instanceof Set) {
    spend(state, 30);
    return {
      __type: 'Set',
      size: object.size,
      values: walkArray(state, Array.from(object), depth),
    };
  }

  // Objects that know how to describe themselves (Moment, Decimal, URL, …).
  const toJSON = (object as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === 'function') {
    let replacement: unknown;
    try {
      replacement = toJSON.call(object);
    } catch (error) {
      return serializeString(state, `[Throws: ${describeThrown(error)}]`);
    }
    if (replacement !== object) {
      return walk(state, replacement, depth) ?? null;
    }
  }

  if (object instanceof Promise) {
    return serializeString(state, '[Promise]');
  }

  const result: { [key: string]: JsonValue } = {};
  spend(state, 2);
  const keys = Object.keys(object);
  walkEntries(state, result, ownEntries(object), keys.length, depth);
  return result;
};

/**
 * Turns any value into a JSON-safe one. Never throws: cycles, throwing
 * getters, exotic objects and oversized payloads all degrade to visible
 * markers instead.
 */
export const safeSerialize = (value: unknown, options: SerializeOptions = {}): SerializeResult => {
  const state: State = {
    options: { ...DEFAULT_SERIALIZE_OPTIONS, ...options },
    budget: options.maxBytes ?? DEFAULT_SERIALIZE_OPTIONS.maxBytes,
    truncated: false,
    ancestors: new Set(),
  };

  try {
    const serialized = walk(state, value, 0);
    return { value: serialized === undefined ? null : serialized, truncated: state.truncated };
  } catch (error) {
    return { value: `[Unserializable: ${describeThrown(error)}]`, truncated: true };
  }
};
