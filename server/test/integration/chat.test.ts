// Integração (Etapa 6 + Fase 2): chat entregue por alcance/sala.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startTestServer, type TestServer } from '../helpers/server.js';
import { connect, health, sleep, useMap, type TestClient } from '../helpers/client.js';
import type { MapData } from '../../../client/src/collision.js';

// Usa o fixture com sala fechada (o mapa real não tem salas) para exercitar
// tanto a entrega por alcance quanto o isolamento por sala.
const FIXTURE = fileURLToPath(new URL('../fixtures/room-map.json', import.meta.url));
const roomMap = JSON.parse(readFileSync(FIXTURE, 'utf8')) as MapData;

const DENTRO = { col: 13, row: 4 };
const FORA_COLADO = { col: 9, row: 4 };
const LONGE = { col: 9, row: 10 }; // 295px do spawn, fora de alcance

let server: TestServer;
let A: TestClient;
let B: TestClient;
let C: TestClient;

before(async () => {
  useMap(roomMap);
  server = await startTestServer({ env: { MAP_PATH: FIXTURE } });
  A = await connect(server.url, 'A');
  B = await connect(server.url, 'B'); // mesmo spawn de A → em alcance
  C = await connect(server.url, 'C');
  await C.walkTo(LONGE.col, LONGE.row); // C se afasta
  await sleep(500);
});

after(async () => {
  for (const c of [A, B, C]) c?.disconnect();
  await server?.close();
});

test('entrega só para quem está em alcance; eco ao remetente', async () => {
  A.reset();
  B.reset();
  C.reset();
  A.say('ola vizinho');
  await sleep(500);
  assert.ok(B.texts().includes('ola vizinho'), 'B (perto) recebeu');
  assert.ok(!C.texts().includes('ola vizinho'), 'C (longe) NÃO recebeu');
  assert.ok(A.texts().includes('ola vizinho'), 'A recebeu o eco');

  const own = A.msgs.find((m) => m.text === 'ola vizinho');
  assert.equal(own?.from, A.id, 'traz o id do remetente');
  assert.ok(typeof own?.at === 'number' && own!.at > 0, 'traz timestamp do servidor');
});

test('sala isola o chat, e entrar na sala volta a receber', async () => {
  await Promise.all([A.walkTo(DENTRO.col, DENTRO.row), B.walkTo(FORA_COLADO.col, FORA_COLADO.row)]);
  await sleep(700);
  A.reset();
  B.reset();
  A.say('segredo da sala');
  await sleep(500);
  assert.ok(!B.texts().includes('segredo da sala'), 'B (fora) não recebeu');

  await B.walkTo(20, 10); // B entra na sala (canto oposto, >170px de A)
  await sleep(700);
  A.reset();
  B.reset();
  A.say('agora voce ouve');
  await sleep(500);
  assert.ok(B.texts().includes('agora voce ouve'), 'mesma sala: B recebeu apesar dos >170px');
});

test('validação de conteúdo: vazio ignorado, trim e truncamento', async () => {
  A.reset();
  B.reset();
  A.say('   ');
  await sleep(400);
  assert.equal(B.msgs.length, 0, 'mensagem em branco ignorada');

  A.reset();
  B.reset();
  A.say('  espacos  ');
  await sleep(400);
  assert.ok(B.texts().includes('espacos'), 'texto trimado');

  A.reset();
  B.reset();
  A.say('x'.repeat(900));
  await sleep(400);
  assert.equal(B.msgs[0]?.text.length, 500, 'truncado em 500');
});

test('nenhum movimento legítimo foi rejeitado', async () => {
  const h = await health(server.url);
  const total = h.rejections.speed + h.rejections.collision + h.rejections.invalid;
  assert.equal(total, 0, `rejeições: ${JSON.stringify(h.rejections)}`);
});
