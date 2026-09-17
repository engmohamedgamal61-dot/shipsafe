/**
 * Bounds how many `run()` calls are in flight at once. Used to cap
 * concurrent Anthropic requests (`AI_MAX_CONCURRENT_REVIEWERS`) so a
 * single review doesn't fire five-plus simultaneous API calls regardless
 * of provider rate limits or self-hosted cost ceilings. Deliberately
 * hand-rolled rather than a dependency — the whole thing is a queue and a
 * counter.
 */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {
    if (maxConcurrent < 1) {
      throw new Error(`ConcurrencyLimiter requires maxConcurrent >= 1, got ${maxConcurrent}`);
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}
