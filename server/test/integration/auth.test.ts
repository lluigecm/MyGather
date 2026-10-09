// Integração (Fase 2, item 4): autenticação por token compartilhado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { startTestServer, type TestServer, sleep } from '../helpers/server.js';

const TOKEN = 'token-secreto-de-teste';
let server: TestServer;

before(async () => {
  server = await startTestServer({ env: { AUTH_TOKEN: TOKEN } });
});
after(async () => {
  await server?.close();
});

/** Tenta conectar e resolve com o resultado (welcome ou erro de auth). */
function tryConnect(auth: Record<string, string>): Promise<
  { ok: true } | { ok: false; code?: string; message: string }
> {
  return new Promise((resolve) => {
    const socket: Socket = io(server.url, { auth, reconnection: false, forceNew: true });
    const done = (r: { ok: true } | { ok: false; code?: string; message: string }): void => {
      socket.disconnect();
      resolve(r);
    };
    socket.on('welcome', () => done({ ok: true }));
    socket.on('connect_error', (err: Error & { data?: { code?: string } }) =>
      done({ ok: false, code: err.data?.code, message: err.message })
    );
    setTimeout(() => done({ ok: false, message: 'timeout' }), 6000);
  });
}

test('conexão sem token é recusada com código AUTH', async () => {
  const r = await tryConnect({});
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, 'AUTH', 'cliente consegue distinguir erro de auth');
});

test('conexão com token errado é recusada', async () => {
  const r = await tryConnect({ token: 'errado' });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, 'AUTH');
});

test('conexão com token correto é aceita (welcome)', async () => {
  const r = await tryConnect({ token: TOKEN });
  assert.equal(r.ok, true);
});

test('token via query string também funciona (link direto)', async () => {
  const socket: Socket = io(server.url, {
    query: { token: TOKEN },
    reconnection: false,
    forceNew: true,
  });
  const ok = await new Promise<boolean>((resolve) => {
    socket.on('welcome', () => resolve(true));
    socket.on('connect_error', () => resolve(false));
    setTimeout(() => resolve(false), 6000);
  });
  socket.disconnect();
  assert.equal(ok, true);
});

test('/ice exige token quando a auth está ligada', async () => {
  const semToken = await fetch(`${server.url}/ice`);
  assert.equal(semToken.status, 401, 'sem token → 401');

  const comTokenErrado = await fetch(`${server.url}/ice?token=errado`);
  assert.equal(comTokenErrado.status, 401, 'token errado → 401');

  const comToken = await fetch(`${server.url}/ice?token=${TOKEN}`);
  assert.equal(comToken.status, 200, 'token correto → 200');
  const body = (await comToken.json()) as { iceServers: unknown[] };
  assert.ok(Array.isArray(body.iceServers));
});

test('comparação de token é resistente a comprimento diferente', async () => {
  // Prefixo do token não pode passar (comparação exige comprimento igual).
  const r = await tryConnect({ token: TOKEN.slice(0, 5) });
  assert.equal(r.ok, false);
});

void sleep;
