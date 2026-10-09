// Integração (Etapas 2–3 + Fase 2): ids únicos, proximidade com movimento real,
// histerese e remoção na desconexão.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, type TestServer } from '../helpers/server.js';
import { connect, health, sleep, type TestClient } from '../helpers/client.js';

let server: TestServer;

before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server?.close();
});

test('ids únicos e spawn autoritativo do servidor', async () => {
  const a = await connect(server.url, 'A');
  const b = await connect(server.url, 'B');
  assert.ok(a.id && b.id && a.id !== b.id, 'ids distintos');
  // Ambos nascem no spawn decidido pelo servidor (não pelo cliente).
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y), 'recebeu posição no welcome');
  assert.deepEqual({ x: a.x, y: a.y }, { x: b.x, y: b.y }, 'mesmo spawn');
  a.disconnect();
  b.disconnect();
  await sleep(200);
});

test('proximidade: conecta perto, desconecta ao se afastar, e remove na saída', async () => {
  const a = await connect(server.url, 'A'); // spawn
  const b = await connect(server.url, 'B'); // mesmo spawn → em alcance

  await sleep(400);
  assert.ok(a.connected.has(b.id!), 'A e B conectam ao nascer juntos');
  assert.ok(b.connected.has(a.id!), 'mútuo');

  // B se afasta para bem longe (outra sala) → peer:leave.
  await b.walkTo(5, 15);
  await sleep(500);
  assert.equal(a.connected.has(b.id!), false, 'A perde B ao se afastar');

  // B desconecta → removido do estado do servidor.
  b.disconnect();
  await sleep(400);
  const h = await health(server.url);
  assert.ok(!h.players.some((p) => p.id === b.id), 'B removido do servidor');

  a.disconnect();
  await sleep(200);
});

test('nenhum movimento legítimo rejeitado', async () => {
  const h = await health(server.url);
  const total = h.rejections.speed + h.rejections.collision + h.rejections.invalid;
  assert.equal(total, 0, `rejeições: ${JSON.stringify(h.rejections)}`);
});
