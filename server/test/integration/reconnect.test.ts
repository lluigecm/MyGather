// Integração (Fase 2, item 7): reconexão preservando identidade de sessão.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { startTestServer, type TestServer } from '../helpers/server.js';
import { connect, health, sleep, tileToPos, useMap } from '../helpers/client.js';
import type { MapData } from '../../../client/src/collision.js';

// Usa o fixture com sala fechada para poder testar a forja de posição para
// DENTRO de uma sala (o mapa real do jogo não tem salas).
const FIXTURE = fileURLToPath(new URL('../fixtures/room-map.json', import.meta.url));
const roomMap = JSON.parse(readFileSync(FIXTURE, 'utf8')) as MapData;

const GRACE = 1500;
let server: TestServer;

before(async () => {
  useMap(roomMap);
  server = await startTestServer({ env: { SESSION_GRACE_MS: String(GRACE), MAP_PATH: FIXTURE } });
});
after(async () => {
  await server?.close();
});

const spawn = tileToPos(3, 3); // spawn autoritativo do servidor (fixture)
const sid = (s: string): string => `sess${s}${'x'.repeat(10)}`;

test('o sessionId NUNCA é exposto: nem em /health, nem no welcome', async () => {
  const secret = 'sessSEGREDONUNCAVAZAxxxxxxxxxx';
  // Captura o welcome COMPLETO por um socket cru.
  const socket = io(server.url, { auth: { sessionId: secret } });
  const welcome = await new Promise<unknown>((resolve, reject) => {
    socket.on('welcome', resolve);
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('sem welcome')), 6000);
  });
  await sleep(200);

  // /health como TEXTO cru (pega o id em qualquer campo).
  const healthText = await (await fetch(`${server.url}/health`)).text();
  assert.ok(!healthText.includes(secret), '/health não contém o sessionId');
  assert.ok(!JSON.stringify(welcome).includes(secret), 'welcome não contém o sessionId');

  socket.disconnect();
  await sleep(200);
});

test('reconexão dentro da janela restaura posição, nome e mudo', async () => {
  const S = sid('A');
  const a = await connect(server.url, 'Ana', S);
  await a.walkTo(5, 3); // move para longe do spawn (posição validada)
  a.setMuted(true);
  await sleep(400);

  const walked = tileToPos(5, 3);
  assert.ok(Math.abs(a.x - walked.x) < 2 && Math.abs(a.y - walked.y) < 2, 'A caminhou até (5,5)');

  a.disconnect();
  await sleep(300); // dentro da carência

  // "Mesma pessoa" volta com o mesmo sessionId.
  const b = await connect(server.url, 'Ana', S);
  assert.ok(
    Math.abs(b.x - walked.x) < 2 && Math.abs(b.y - walked.y) < 2,
    `retomou a posição (${b.x},${b.y}) e não o spawn`
  );
  assert.notEqual(b.id, a.id, 'é um socket.id NOVO');

  const p = (await health(server.url)).players.find((x) => x.id === b.id)!;
  assert.equal(p.name, 'Ana', 'nome preservado');
  assert.equal(p.muted, true, 'estado de mudo preservado');
  assert.equal(p.roomId, null, 'roomId recalculado da posição restaurada');
  b.disconnect();
  await sleep(200);
});

test('sem sessionId conhecido: nasce no spawn (não confia em posição do cliente)', async () => {
  const a = await connect(server.url, 'Bia', sid('B'));
  await a.walkTo(6, 3);
  await sleep(300);
  a.disconnect();
  await sleep(200);

  // Novo sessionId (nunca visto) → spawn.
  const c = await connect(server.url, 'Bia', sid('DIFERENTE'));
  assert.ok(Math.abs(c.x - spawn.x) < 2 && Math.abs(c.y - spawn.y) < 2, 'nasceu no spawn');
  c.disconnect();
  await sleep(200);
});

test('reconexão após a janela de carência: volta ao spawn', async () => {
  const S = sid('C');
  const a = await connect(server.url, 'Caio', S);
  await a.walkTo(5, 3);
  await sleep(300);
  a.disconnect();

  await sleep(GRACE + 500); // deixa expirar

  const b = await connect(server.url, 'Caio', S);
  assert.ok(Math.abs(b.x - spawn.x) < 2 && Math.abs(b.y - spawn.y) < 2, 'expirou → spawn');
  b.disconnect();
  await sleep(200);
});

test('cliente não consegue forjar posição via sessionId (posição vem do servidor)', async () => {
  // Emite um "move" para dentro da sala fechada — é rejeitado (item 1). A queda
  // salva a ÚLTIMA posição válida (fora da sala), não a forjada.
  const S = sid('D');
  const a = await connect(server.url, 'Dan', S);
  const insideRoom = tileToPos(13, 4); // interior da sala fechada
  a.socket.emit('move', { x: insideRoom.x, y: insideRoom.y }); // teleporte forjado
  await sleep(300);
  a.disconnect();
  await sleep(300);

  const b = await connect(server.url, 'Dan', S);
  const p = (await health(server.url)).players.find((x) => x.id === b.id)!;
  assert.equal(p.roomId, null, 'religou FORA da sala (a posição forjada nunca foi aceita)');
  b.disconnect();
  await sleep(200);
});
