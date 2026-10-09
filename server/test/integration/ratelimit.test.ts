// Integração (Fase 2, item 5): rate limiting de chat/move e CORS restrito.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, type TestServer } from '../helpers/server.js';
import { connect, health, sleep, type TestClient } from '../helpers/client.js';

let server: TestServer;

before(async () => {
  // Limites de chat baixos para exercitar sem esperar muito.
  server = await startTestServer({ env: { RL_CHAT_RATE: '2', ALLOWED_ORIGINS: 'https://ok.example' } });
});
after(async () => {
  await server?.close();
});

test('chat: rajada acima do limite é descartada e contabilizada', async () => {
  const a: TestClient = await connect(server.url, 'A');
  const b: TestClient = await connect(server.url, 'B'); // mesmo spawn → em alcance
  await sleep(300);
  b.reset();

  // Dispara 30 mensagens instantâneas; burst de chat = 5.
  for (let i = 0; i < 30; i++) a.say(`msg ${i}`);
  await sleep(600);

  assert.ok(b.msgs.length >= 3 && b.msgs.length <= 8, `entregou ~burst, não as 30 (${b.msgs.length})`);
  const h = await health(server.url);
  assert.ok(h.rateLimited.chat > 0, 'servidor contabilizou chat descartado');

  a.disconnect();
  b.disconnect();
  await sleep(200);
});

test('move: taxa normal de caminhada não é limitada', async () => {
  const a = await connect(server.url, 'A');
  await a.walkTo(19, 11); // caminhada legítima (~25/s, abaixo do teto de 30/s)
  await sleep(300);
  const h = await health(server.url);
  assert.equal(h.rateLimited.move, 0, 'caminhada legítima não gera descarte de move');
  const p = h.players.find((x) => x.id === a.id)!;
  assert.ok(Math.abs(p.x - (19 * 32 + 4)) < 2, 'o avatar realmente andou até o destino');
  a.disconnect();
  await sleep(200);
});

test('CORS: origem permitida é refletida, origem estranha não', async () => {
  const ok = await fetch(`${server.url}/health`, { headers: { Origin: 'https://ok.example' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://ok.example');

  const bad = await fetch(`${server.url}/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null, 'origem não-listada não recebe o header');
});
