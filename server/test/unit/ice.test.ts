// Unitário (Fase 2, item 3): geração de config ICE e credenciais TURN efêmeras.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  buildIceServers,
  ephemeralTurnCredentials,
  iceOptionsFromEnv,
  type IceOptions,
} from '../../src/ice.js';

const SECRET = 'segredo-de-teste';
const NOW = 1_700_000_000_000; // instante fixo (ms)

test('credenciais efêmeras batem com a HMAC que o coturn espera', () => {
  const ttl = 3600;
  const { username, credential } = ephemeralTurnCredentials(SECRET, ttl, 'mygather', NOW);

  const expectedExpiry = Math.floor(NOW / 1000) + ttl;
  assert.equal(username, `${expectedExpiry}:mygather`, 'username = expiry:label');

  // Recomputa de forma independente (mesmo algoritmo do coturn use-auth-secret).
  const expected = createHmac('sha1', SECRET).update(username).digest('base64');
  assert.equal(credential, expected, 'credential = base64(HMAC-SHA1(secret, username))');
});

test('sem label, o username é só o timestamp de expiração', () => {
  const { username } = ephemeralTurnCredentials(SECRET, 60, undefined, NOW);
  assert.equal(username, String(Math.floor(NOW / 1000) + 60));
});

const base = (over: Partial<IceOptions> = {}): IceOptions => ({
  stunUrls: ['stun:s.example:3478'],
  turnUrls: [],
  turnTtlSeconds: 3600,
  label: 'mygather',
  ...over,
});

test('buildIceServers: só STUN quando não há TURN', () => {
  const servers = buildIceServers(base(), NOW);
  assert.deepEqual(servers, [{ urls: 'stun:s.example:3478' }]);
});

test('buildIceServers: STUN + TURN efêmero quando há segredo', () => {
  const servers = buildIceServers(
    base({ turnUrls: ['turn:t.example:3478', 'turns:t.example:5349'], turnSecret: SECRET }),
    NOW
  );
  assert.equal(servers.length, 2);
  const turn = servers[1];
  assert.deepEqual(turn.urls, ['turn:t.example:3478', 'turns:t.example:5349']);
  const expiry = Math.floor(NOW / 1000) + 3600;
  assert.equal(turn.username, `${expiry}:mygather`);
  assert.equal(turn.credential, createHmac('sha1', SECRET).update(turn.username!).digest('base64'));
});

test('buildIceServers: TURN com credenciais estáticas', () => {
  const servers = buildIceServers(
    base({ turnUrls: ['turn:t.example:3478'], turnStaticUsername: 'u', turnStaticCredential: 'p' }),
    NOW
  );
  assert.equal(servers[1].username, 'u');
  assert.equal(servers[1].credential, 'p');
});

test('buildIceServers: TURN sem credencial é ignorado (config inútil)', () => {
  const servers = buildIceServers(base({ turnUrls: ['turn:t.example:3478'] }), NOW);
  assert.equal(servers.length, 1, 'só o STUN');
});

test('iceOptionsFromEnv: parsing de listas e defaults', () => {
  const opts = iceOptionsFromEnv({
    STUN_URLS: 'stun:a:3478, stun:b:3478',
    TURN_URLS: 'turn:t:3478 , turns:t:5349',
    TURN_SECRET: SECRET,
    TURN_TTL_SECONDS: '600',
  } as NodeJS.ProcessEnv);
  assert.deepEqual(opts.stunUrls, ['stun:a:3478', 'stun:b:3478']);
  assert.deepEqual(opts.turnUrls, ['turn:t:3478', 'turns:t:5349']);
  assert.equal(opts.turnSecret, SECRET);
  assert.equal(opts.turnTtlSeconds, 600);
});

test('iceOptionsFromEnv: STUN público como default quando nada é configurado', () => {
  const opts = iceOptionsFromEnv({} as NodeJS.ProcessEnv);
  assert.ok(opts.stunUrls.length === 1 && opts.stunUrls[0].startsWith('stun:'));
  assert.deepEqual(opts.turnUrls, []);
});
