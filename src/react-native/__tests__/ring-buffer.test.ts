import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../ring-buffer';

describe('RingBuffer', () => {
  it('keeps items oldest first until full', () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);

    expect(buffer.toArray()).toEqual([1, 2]);
    expect(buffer.size).toBe(2);
  });

  it('evicts the oldest item once full and returns it', () => {
    const buffer = new RingBuffer<number>(3);
    [1, 2, 3].forEach((item) => buffer.push(item));

    expect(buffer.push(4)).toBe(1);
    expect(buffer.push(5)).toBe(2);
    expect(buffer.toArray()).toEqual([3, 4, 5]);
    expect(buffer.size).toBe(3);
  });

  it('wraps around many times without losing order', () => {
    const buffer = new RingBuffer<number>(4);
    for (let item = 1; item <= 1003; item += 1) {
      buffer.push(item);
    }

    expect(buffer.toArray()).toEqual([1000, 1001, 1002, 1003]);
  });

  it('clears', () => {
    const buffer = new RingBuffer<number>(2);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.clear();

    expect(buffer.toArray()).toEqual([]);
    buffer.push(4);
    expect(buffer.toArray()).toEqual([4]);
  });

  it('shrinks to the newest items and grows without losing any', () => {
    const buffer = new RingBuffer<number>(5);
    [1, 2, 3, 4, 5, 6, 7].forEach((item) => buffer.push(item));

    buffer.resize(2);
    expect(buffer.toArray()).toEqual([6, 7]);
    expect(buffer.capacity).toBe(2);

    buffer.resize(4);
    buffer.push(8);
    buffer.push(9);
    buffer.push(10);
    expect(buffer.toArray()).toEqual([7, 8, 9, 10]);
  });

  it('treats a nonsensical capacity as 1 instead of throwing', () => {
    for (const capacity of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const buffer = new RingBuffer<number>(capacity);
      buffer.push(1);
      buffer.push(2);
      expect(buffer.toArray()).toEqual([2]);
    }
  });
});
