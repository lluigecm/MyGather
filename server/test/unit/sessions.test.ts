// Unitário (Fase 2, item 7): SessionStore (guardar/restaurar com carência).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore, isValidSessionId, type SavedSession } from '../../src/sessions.js';

const S = (over: Partial<SavedSession> = {}): SavedSession => ({
  x: 100,
  y: 200,
  name: 'Ana',
  muted: false,
  ...over,
});

test('restaura dentro da janela de carência', () => {
  const store = new SessionStore(60_000);
  const t0 = 1_000_000;
  store.save('sess-abc123', S({ x: 300, muted: true }), t0);
  const got = store.take('sess-abc123', t0 + 30_000);
  assert.ok(got);
  assert.equal(got!.x, 300);
  assert.equal(got!.muted, true);
});

test('take é de uso único (não restaura duas vezes)', () => {
  const store = new SessionStore(60_000);
  const t0 = 1_000_000;
  store.save('sess-abc123', S(), t0);
  assert.ok(store.take('sess-abc123', t0 + 1000));
  assert.equal(store.take('sess-abc123', t0 + 2000), null, 'segunda tentativa não restaura');
});

test('expira após a janela', () => {
  const store = new SessionStore(60_000);
  const t0 = 1_000_000;
  store.save('sess-abc123', S(), t0);
  assert.equal(store.take('sess-abc123', t0 + 60_001), null, 'passou da carência → null');
});

test('sessão desconhecida → null', () => {
  const store = new SessionStore(60_000);
  assert.equal(store.take('nao-existe', 1_000_000), null);
});

test('sweep remove expiradas e mantém válidas', () => {
  const store = new SessionStore(60_000);
  const t0 = 1_000_000;
  store.save('velha', S(), t0);
  store.save('nova', S(), t0 + 55_000);
  store.sweep(t0 + 61_000);
  assert.equal(store.size, 1, 'só a nova sobrevive');
  assert.ok(store.take('nova', t0 + 61_000));
});

test('isValidSessionId aceita ids plausíveis e rejeita o resto', () => {
  assert.equal(isValidSessionId('a'.repeat(32)), true);
  assert.equal(isValidSessionId('abc12345'), true);
  assert.equal(isValidSessionId('curto'), false, 'muito curto');
  assert.equal(isValidSessionId('a'.repeat(200)), false, 'muito longo');
  assert.equal(isValidSessionId('tem espaço aqui!'), false, 'caractere inválido');
  assert.equal(isValidSessionId(undefined), false);
  assert.equal(isValidSessionId(12345678), false, 'não-string');
});
