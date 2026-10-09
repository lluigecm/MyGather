// Integração (Fase 2, item 1): o cenário motivador — cliente forjado tentando
// entrar numa sala fechada sem passar pela porta deve ser bloqueado.
// Usa socket.io cru de propósito (ignora o cliente legítimo da aplicação).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { startTestServer, type TestServer } from '../helpers/server.js';
import { connect, health, sleep, tileToPos, useMap, type TestClient } from '../helpers/client.js';
import type { MapData } from '../../../client/src/collision.js';

// Cenário de sala fechada → roda sobre o fixture com sala (mapa real não tem).
const FIXTURE = fileURLToPath(new URL('../fixtures/room-map.json', import.meta.url));
const roomMap = JSON.parse(readFileSync(FIXTURE, 'utf8')) as MapData;

const DENTRO = { col: 13, row: 4 };
const FORA_COLADO = { col: 9, row: 4 };
const dentroPos = tileToPos(DENTRO.col, DENTRO.row);

let server: TestServer;
let spy: TestClient;

before(async () => {
  useMap(roomMap);
  server = await startTestServer({ env: { MAP_PATH: FIXTURE } });
  spy = await connect(server.url, 'Espiao');
});

after(async () => {
  spy?.disconnect();
  await server?.close();
});

test('forjar posição no handshake NÃO coloca ninguém dentro da sala', async () => {
  const forger = io(server.url, { query: { name: 'Forjador', x: dentroPos.x, y: dentroPos.y } });
  let selfSpawn: { x: number; y: number } | null = null;
  forger.on('welcome', (d: { self: { x: number; y: number } }) => (selfSpawn = d.self));
  for (let i = 0; i < 40 && !selfSpawn; i++) await sleep(50);

  const p = (await health(server.url)).players.find((x) => x.name === 'Forjador');
  assert.ok(p, 'conectou');
  assert.equal(p!.roomId, null, 'handshake forjado não entra na sala');
  assert.ok(p!.x !== dentroPos.x || p!.y !== dentroPos.y, 'servidor ignorou a posição do handshake');
  forger.disconnect();
  await sleep(300);
});

test('teleportar via move para dentro da sala é rejeitado e corrigido', async () => {
  const before = (await health(server.url)).rejections.speed;
  spy.reset();
  spy.socket.emit('move', { x: dentroPos.x, y: dentroPos.y });
  await sleep(400);

  const p = (await health(server.url)).players.find((x) => x.id === spy.id)!;
  assert.equal(p.roomId, null, 'não entrou na sala');
  assert.ok((await health(server.url)).rejections.speed > before, 'contabilizado como violação de velocidade');
  assert.ok(spy.events.corrections.length > 0, 'servidor devolveu position:correction');
  const c = spy.events.corrections.at(-1)!;
  assert.ok(Math.abs(c.x - p.x) < 0.01 && Math.abs(c.y - p.y) < 0.01, 'correção = última posição válida');
});

test('rajada de passos pequenos não fura a parede da sala', async () => {
  const p0 = (await health(server.url)).players.find((x) => x.id === spy.id)!;
  for (let i = 0; i < 200; i++) spy.socket.emit('move', { x: p0.x + (i + 1) * 8, y: p0.y });
  await sleep(600);
  const p = (await health(server.url)).players.find((x) => x.id === spy.id)!;
  const traveled = Math.hypot(p.x - p0.x, p.y - p0.y);
  assert.ok(traveled <= 60, `rajada limitada pelo orçamento (andou ${traveled.toFixed(1)}px)`);
  assert.equal(p.roomId, null, 'rajada não entrou na sala');
});

test('isolamento mantido: espião colado na parede não ouve o morador da sala', async () => {
  const morador = await connect(server.url, 'Morador');
  await morador.walkTo(DENTRO.col, DENTRO.row);
  await spy.walkTo(FORA_COLADO.col, FORA_COLADO.row);
  await sleep(600);
  spy.reset();
  morador.reset();

  // Tenta forjar a entrada repetidamente.
  for (let i = 0; i < 30; i++) {
    spy.socket.emit('move', { x: dentroPos.x, y: dentroPos.y });
    await sleep(20);
  }
  await sleep(600);

  const h = await health(server.url);
  const s = h.players.find((x) => x.id === spy.id)!;
  const m = h.players.find((x) => x.id === morador.id)!;
  assert.equal(s.roomId, null, 'espião continua fora');
  assert.ok(Math.hypot(s.x - m.x, s.y - m.y) <= 150, 'espião fisicamente perto do morador');
  assert.equal(spy.connected.has(morador.id!), false, 'sem conexão espião↔morador');

  morador.reset();
  spy.reset();
  morador.say('assunto confidencial');
  await sleep(500);
  assert.ok(!spy.texts().includes('assunto confidencial'), 'chat da sala não vazou');

  // Entrando LEGITIMAMENTE pela porta, aí sim conecta.
  spy.reset();
  await spy.walkTo(DENTRO.col, DENTRO.row);
  await sleep(700);
  const s2 = (await health(server.url)).players.find((x) => x.id === spy.id)!;
  assert.equal(s2.roomId, 'sala-reuniao', 'entrando pela porta o servidor aceita');
  assert.ok(spy.connected.has(morador.id!), 'após entrar, conecta com o morador');

  morador.disconnect();
});
