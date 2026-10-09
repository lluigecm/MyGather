// Integração (Etapa 5 + Fase 2): salas fechadas com clientes que caminham de
// verdade (o servidor valida velocidade/colisão, então teleporte não cola).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startTestServer, type TestServer } from '../helpers/server.js';
import { connect, health, sleep, useMap, type TestClient } from '../helpers/client.js';
import type { MapData } from '../../../client/src/collision.js';

// O mapa real do jogo não tem salas fechadas (decisão do usuário). Este teste
// verifica o ISOLAMENTO de sala — então roda sobre um fixture com uma sala.
const FIXTURE = fileURLToPath(new URL('../fixtures/room-map.json', import.meta.url));
const roomMap = JSON.parse(readFileSync(FIXTURE, 'utf8')) as MapData;

const DENTRO = { col: 13, row: 4 };
const DENTRO_LONGE = { col: 20, row: 10 }; // canto oposto da sala, 295px de DENTRO
const FORA_COLADO = { col: 9, row: 4 }; // 128px de DENTRO, fora da sala, parede no meio
const FORA_PERTO = { col: 9, row: 5 }; // fora, colado em FORA_COLADO

let server: TestServer;
let A: TestClient;
let B: TestClient;
let C: TestClient;

before(async () => {
  useMap(roomMap); // pathfinding do harness no mesmo mapa do servidor
  server = await startTestServer({ env: { MAP_PATH: FIXTURE } });
  A = await connect(server.url, 'A');
  B = await connect(server.url, 'B');
  C = await connect(server.url, 'C');
});

after(async () => {
  for (const c of [A, B, C]) c?.disconnect();
  await server?.close();
});

test('A entra na sala pela porta; B fica colado do lado de fora e não conecta', async () => {
  await Promise.all([A.walkTo(DENTRO.col, DENTRO.row), B.walkTo(FORA_COLADO.col, FORA_COLADO.row)]);
  await sleep(700);

  const h = await health(server.url);
  const a = h.players.find((p) => p.id === A.id)!;
  const b = h.players.find((p) => p.id === B.id)!;
  assert.equal(a.roomId, 'sala-reuniao', 'A na sala');
  assert.equal(b.roomId, null, 'B fora');
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(d <= 150, `A e B fisicamente próximos (${d.toFixed(1)}px)`);

  A.reset();
  B.reset();
  await sleep(400);
  assert.equal(A.connected.has(B.id!), false, 'A não conectado a B');
  assert.equal(B.connected.has(A.id!), false, 'B não conectado a A');
});

test('C entra na sala (canto oposto): conecta com A apesar dos >170px', async () => {
  A.reset();
  C.reset();
  await C.walkTo(DENTRO_LONGE.col, DENTRO_LONGE.row);
  await sleep(700);

  const h = await health(server.url);
  const a = h.players.find((p) => p.id === A.id)!;
  const c = h.players.find((p) => p.id === C.id)!;
  assert.equal(c.roomId, 'sala-reuniao');
  assert.ok(Math.hypot(a.x - c.x, a.y - c.y) > 170, 'A e C além do raio de proximidade');
  assert.ok(A.connected.has(C.id!), 'A conectado a C (mesma sala)');
  assert.equal(C.connected.has(B.id!), false, 'C (dentro) não conecta com B (fora)');
});

test('C sai da sala e conecta com B por proximidade; A perde C', async () => {
  A.reset();
  B.reset();
  C.reset();
  await C.walkTo(FORA_PERTO.col, FORA_PERTO.row);
  await sleep(700);
  assert.ok(A.events.leave.includes(C.id!), 'A recebeu peer:leave de C');
  assert.ok(C.connected.has(B.id!), 'fora da sala, C e B conectam por proximidade');
});

test('nenhum movimento legítimo foi rejeitado pelo servidor', async () => {
  const h = await health(server.url);
  const total = h.rejections.speed + h.rejections.collision + h.rejections.invalid;
  assert.equal(total, 0, `rejeições: ${JSON.stringify(h.rejections)}`);
});
