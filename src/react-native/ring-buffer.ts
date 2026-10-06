/**
 * Fixed-capacity FIFO. Pushing onto a full buffer evicts the oldest item.
 * Push is O(1) and allocation-free once the backing array has grown, which
 * matters because it is the only work `timeline.log()` does while no
 * DevTools panel is listening.
 */
export class RingBuffer<T> {
  private items: (T | undefined)[] = [];
  private head = 0;
  private length = 0;
  private cap: number;

  constructor(capacity: number) {
    this.cap = RingBuffer.normalizeCapacity(capacity);
  }

  private static normalizeCapacity(capacity: number): number {
    return Number.isFinite(capacity) && capacity >= 1 ? Math.floor(capacity) : 1;
  }

  get size(): number {
    return this.length;
  }

  get capacity(): number {
    return this.cap;
  }

  /** Adds an item, returning the evicted one when the buffer was full. */
  push(item: T): T | undefined {
    if (this.length < this.cap) {
      this.items[(this.head + this.length) % this.cap] = item;
      this.length += 1;
      return undefined;
    }
    const evicted = this.items[this.head];
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.cap;
    return evicted;
  }

  /** Oldest first. */
  toArray(): T[] {
    const result: T[] = new Array(this.length);
    for (let index = 0; index < this.length; index += 1) {
      result[index] = this.items[(this.head + index) % this.cap] as T;
    }
    return result;
  }

  clear(): void {
    this.items = [];
    this.head = 0;
    this.length = 0;
  }

  /** Changes the capacity, keeping the newest items that still fit. */
  resize(capacity: number): void {
    const next = RingBuffer.normalizeCapacity(capacity);
    if (next === this.cap) {
      return;
    }
    const kept = this.toArray().slice(-next);
    this.cap = next;
    this.items = kept;
    this.head = 0;
    this.length = kept.length;
  }
}
