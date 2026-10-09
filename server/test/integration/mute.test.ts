// Integração (Fase 2, item 6): estado de mudo propagado pelo servidor.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, type TestServer } from '../helpers/server.js';
import { connect, health, sleep, type TestClient } from '../helpers/client.js';

let server: TestServer;
let a: TestClient;
let b: TestClient;

before(async () => {
  server = await startTestServer();
  a = await connect(server.url, 'A');
  b = await connect(server.url, 'B'); // mesmo spawn → vê o A
  await sleep(300);
});
after(async () => {
  a?.disconnect();
  b?.disconnect();
  await server?.close();
});

test('mudar-se propaga: servidor armazena e avisa os outros', async () => {
  a.setMuted(true);
  await sleep(300);

  const p = (await health(server.url)).players.find((x) => x.id === a.id)!;
  assert.equal(p.muted, true, 'servidor armazenou muted=true');
  assert.equal(b.remoteMuted.get(a.id!), true, 'B recebeu player:muted de A');
});

test('desmutar propaga de volta', async () => {
  a.setMuted(false);
  await sleep(300);
  const p = (await health(server.url)).players.find((x) => x.id === a.id)!;
  assert.equal(p.muted, false);
  assert.equal(b.remoteMuted.get(a.id!), false, 'B vê A desmutado');
});

test('estado repetido não gera evento redundante', async () => {
  a.setMuted(true);
  await sleep(200);
  b.remoteMuted.set(a.id!, 'sentinela' as unknown as boolean); // marcador
  a.setMuted(true); // mesmo estado → servidor não deve reemitir
  await sleep(300);
  assert.equal(b.remoteMuted.get(a.id!), 'sentinela' as unknown as boolean, 'sem reemissão redundante');
});
