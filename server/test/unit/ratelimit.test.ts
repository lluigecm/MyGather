// Unitário (Fase 2, item 5): token bucket e rate limiter por chave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket, KeyedRateLimiter } from '../../src/ratelimit.js';

test('token bucket: permite até a capacidade e depois nega', () => {
  const t0 = 1_000_000;
  const b = new TokenBucket(10, 5, t0); // 10/s, burst 5
  let allowed = 0;
  for (let i = 0; i < 20; i++) if (b.tryConsume(t0)) allowed++; // tudo no mesmo instante
  assert.equal(allowed, 5, 'só a capacidade inicial passa sem tempo decorrido');
});

test('token bucket: recarrega com o tempo', () => {
  const t0 = 1_000_000;
  const b = new TokenBucket(10, 5, t0);
  for (let i = 0; i < 5; i++) b.tryConsume(t0); // esvazia
  assert.equal(b.tryConsume(t0), false, 'vazio');
  assert.equal(b.tryConsume(t0 + 100), true, '100ms → +1 ficha (10/s)');
  assert.equal(b.tryConsume(t0 + 100), false, 'só uma ficha recarregada');
});

test('token bucket: recarga satura na capacidade (sem crédito infinito)', () => {
  const t0 = 1_000_000;
  const b = new TokenBucket(10, 5, t0);
  b.tryConsume(t0); // 4 restantes
  // Após muito tempo, satura em 5 (não acumula além da capacidade).
  let allowed = 0;
  for (let i = 0; i < 20; i++) if (b.tryConsume(t0 + 3_600_000)) allowed++;
  assert.equal(allowed, 5, 'no máximo a capacidade após longa ociosidade');
});

test('keyed rate limiter: baldes independentes por chave', () => {
  const t0 = 1_000_000;
  const rl = new KeyedRateLimiter(1, 3); // 1/s, burst 3
  assert.equal(rl.allow('a', t0), true);
  assert.equal(rl.allow('a', t0), true);
  assert.equal(rl.allow('a', t0), true);
  assert.equal(rl.allow('a', t0), false, 'a esgotou');
  assert.equal(rl.allow('b', t0), true, 'b tem o próprio balde');
});
