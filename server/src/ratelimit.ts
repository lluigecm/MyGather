// Rate limiting por token bucket (Fase 2, item 5).
//
// Cada balde recarrega `ratePerSec` fichas por segundo, saturando em
// `capacity`. Uma ação custa 1 ficha; sem ficha, a ação é negada. Isso permite
// rajadas curtas (até a capacidade) mas limita a taxa sustentada.

export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly capacity: number,
    now: number = Date.now()
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  /** Tenta consumir 1 ficha. Retorna true se permitido. */
  tryConsume(now: number = Date.now()): boolean {
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.ratePerSec);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Balde cheio e ocioso → pode ser descartado (para limpeza). */
  isFull(now: number = Date.now()): boolean {
    const elapsed = Math.max(0, now - this.last) / 1000;
    return this.tokens + elapsed * this.ratePerSec >= this.capacity;
  }
}

/**
 * Rate limiter com um balde por chave (ex.: por IP). Faz uma limpeza periódica
 * dos baldes cheios/ociosos para não crescer sem limite.
 */
export class KeyedRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  private lastSweep = 0;

  constructor(
    private readonly ratePerSec: number,
    private readonly capacity: number
  ) {}

  allow(key: string, now: number = Date.now()): boolean {
    this.maybeSweep(now);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(this.ratePerSec, this.capacity, now);
      this.buckets.set(key, bucket);
    }
    return bucket.tryConsume(now);
  }

  private maybeSweep(now: number): void {
    if (now - this.lastSweep < 30_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.isFull(now)) this.buckets.delete(key);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}
