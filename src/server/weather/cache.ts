interface CacheEntry<Value> {
  value: Value;
  expiresAt: number;
}

/** Small process-memory-only LRU. Entries are never serialized or handed to a framework cache. */
export class MemoryLruCache<Value> {
  private readonly entries = new Map<string, CacheEntry<Value>>();

  constructor(
    private readonly capacity = 128,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: Value, ttlMs: number): void {
    if (this.capacity <= 0 || ttlMs <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
