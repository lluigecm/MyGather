// Integração (Fase 2, item 3): servidor em HTTPS/WSS entregando os iceServers
// (STUN + TURN efêmero) ao cliente. NÃO testa o relay TURN real (precisaria do
// coturn no ar atrás de NAT) — testa o plumbing HTTPS e a geração/entrega das
// credenciais que o coturn espera.

// Self-signed → o Node precisa aceitar o cert nos testes.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { startTestServer, type TestServer, sleep } from '../helpers/server.js';

function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const OPENSSL = hasOpenssl();
const TURN_SECRET = 'segredo-de-integracao';
const TURN_URL = 'turn:turn.example.test:3478';
const STUN_URL = 'stun:stun.example.test:3478';

let server: TestServer;
let certDir: string;

before(async () => {
  if (!OPENSSL) return; // testes marcados como skip abaixo
  certDir = mkdtempSync(join(tmpdir(), 'mygather-cert-'));
  const cert = join(certDir, 'cert.pem');
  const key = join(certDir, 'key.pem');
  execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', cert, '-days', '1',
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { stdio: 'ignore' }
  );

  server = await startTestServer({
    https: true,
    env: {
      TLS_CERT: cert,
      TLS_KEY: key,
      TURN_URLS: TURN_URL,
      TURN_SECRET,
      STUN_URLS: STUN_URL,
    },
  });
});

after(async () => {
  await server?.close();
  if (certDir) rmSync(certDir, { recursive: true, force: true });
});

test('servidor responde /health sobre HTTPS', { skip: !OPENSSL && 'openssl indisponível' }, async () => {
  assert.ok(server.url.startsWith('https://'), 'URL é https');
  const res = await fetch(`${server.url}/health`);
  assert.equal(res.ok, true);
  const body = (await res.json()) as { ok: boolean };
  assert.equal(body.ok, true);
});

test('welcome (via WSS) traz iceServers com STUN e TURN efêmero válido', { skip: !OPENSSL && 'openssl indisponível' }, async () => {
  const socket: Socket = io(server.url, { rejectUnauthorized: false, query: { name: 'Ana' } });
  const welcome = await new Promise<{ iceServers: { urls: string | string[]; username?: string; credential?: string }[] }>(
    (resolve, reject) => {
      socket.on('welcome', resolve);
      socket.on('connect_error', reject);
      setTimeout(() => reject(new Error('welcome não chegou')), 8000);
    }
  );

  const ice = welcome.iceServers;
  assert.ok(Array.isArray(ice) && ice.length >= 2, 'tem STUN e TURN');

  const stun = ice.find((s) => String(s.urls).includes('stun:'));
  assert.ok(stun, 'STUN presente');
  assert.equal(String(stun!.urls), STUN_URL);

  const turn = ice.find((s) => String(s.urls).includes('turn:'));
  assert.ok(turn, 'TURN presente');
  assert.equal(String(turn!.urls), TURN_URL);
  assert.ok(turn!.username && turn!.credential, 'TURN com credenciais');

  // A credencial tem de ser a HMAC que o coturn validaria.
  const expected = createHmac('sha1', TURN_SECRET).update(turn!.username!).digest('base64');
  assert.equal(turn!.credential, expected, 'credential = base64(HMAC-SHA1(secret, username))');

  // username = "<expiry>:mygather", com expiry no futuro.
  const [expiryStr] = turn!.username!.split(':');
  assert.ok(Number(expiryStr) > Math.floor(Date.now() / 1000), 'expiry no futuro');

  socket.disconnect();
  await sleep(100);
});

test('endpoint /ice devolve credenciais frescas', { skip: !OPENSSL && 'openssl indisponível' }, async () => {
  const res = await fetch(`${server.url}/ice`);
  const body = (await res.json()) as { iceServers: { urls: string | string[]; credential?: string }[] };
  const turn = body.iceServers.find((s) => String(s.urls).includes('turn:'));
  assert.ok(turn?.credential, '/ice traz credencial TURN');
});

if (!OPENSSL) {
  test('HTTPS/ICE: openssl indisponível — testes pulados', { skip: 'openssl indisponível neste ambiente' }, () => {});
}
