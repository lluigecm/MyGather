// Unitário: proximidade (Etapa 3) + salas fechadas (Etapa 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ProximityManager, roomIdAtWorld, type Point, type RoomMap } from '../../src/rooms.js';

function mk(): {
  enters: string[];
  leaves: string[];
  tick: (pts: Point[]) => void;
  mgr: ProximityManager;
} {
  const enters: string[] = [];
  const leaves: string[] = [];
  const mgr = new ProximityManager({ enterRadius: 150, leaveRadius: 170 });
  const key = (a: string, b: string): string => [a, b].sort().join('|');
  const tick = (pts: Point[]): void =>
    mgr.tick(pts, (a, b) => enters.push(key(a, b)), (a, b) => leaves.push(key(a, b)));
  return { enters, leaves, tick, mgr };
}
const P = (id: string, x: number, y: number, roomId: string | null = null): Point => ({ id, x, y, roomId });

test('proximidade: entra em <=150, não repete, sai em >170 (histerese)', () => {
  const { enters, leaves, tick } = mk();
  tick([P('A', 0, 0), P('B', 200, 0)]);
  assert.equal(enters.length, 0);
  tick([P('A', 0, 0), P('B', 150, 0)]);
  assert.deepEqual(enters, ['A|B']);
  tick([P('A', 0, 0), P('B', 120, 0)]);
  assert.equal(enters.length, 1, 'não re-dispara enter estando perto');
  tick([P('A', 0, 0), P('B', 160, 0)]);
  assert.equal(leaves.length, 0, 'banda de histerese: sem leave');
  tick([P('A', 0, 0), P('B', 171, 0)]);
  assert.deepEqual(leaves, ['A|B']);
});

test('proximidade: todos os pares (3 jogadores)', () => {
  const { enters, tick } = mk();
  tick([P('A', 0, 0), P('B', 100, 0), P('C', 0, 100)]); // B-C = ~141 <= 150
  assert.deepEqual(enters.sort(), ['A|B', 'A|C', 'B|C']);
});

test('proximidade: removePlayer dispara leave para pares próximos', () => {
  const { enters, leaves, tick, mgr } = mk();
  tick([P('A', 0, 0), P('B', 100, 0)]);
  assert.equal(enters.length, 1);
  const removed: string[] = [];
  mgr.removePlayer('A', (a, b) => removed.push([a, b].sort().join('|')));
  assert.deepEqual(removed, ['A|B']);
  void leaves;
});

test('salas: mesma sala conecta a qualquer distância', () => {
  const { enters, tick } = mk();
  tick([P('A', 0, 0, 'sala-1'), P('B', 5000, 5000, 'sala-1')]);
  assert.deepEqual(enters, ['A|B']);
});

test('salas: dentro x fora e salas diferentes nunca conectam', () => {
  const a = mk();
  a.tick([P('A', 0, 0, 'sala-1'), P('B', 10, 0, null)]);
  assert.equal(a.enters.length, 0, 'dentro x fora, mesmo colados');

  const b = mk();
  b.tick([P('A', 0, 0, 'sala-1'), P('B', 10, 0, 'sala-2')]);
  assert.equal(b.enters.length, 0, 'salas diferentes, mesmo colados');
});

test('salas: entrar/sair reconfigura conexões independentemente da distância', () => {
  const { enters, leaves, tick } = mk();
  tick([P('A', 0, 0, 'sala-1'), P('B', 900, 0, null)]);
  assert.equal(enters.length, 0, 'fora e longe → desconectados');
  tick([P('A', 0, 0, 'sala-1'), P('B', 900, 0, 'sala-1')]);
  assert.equal(enters.length, 1, 'B entra na sala → conecta apesar da distância');
  tick([P('A', 0, 0, 'sala-1'), P('B', 900, 0, null)]);
  assert.equal(leaves.length, 1, 'B sai da sala → desconecta (estava longe)');
});

test('roomIdAtWorld no mapa real', () => {
  const raw = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../client/src/map.json', import.meta.url)), 'utf8')
  ) as RoomMap;
  const ts = raw.tileSize;
  const center = (col: number, row: number): [number, number] => [col * ts + ts / 2, row * ts + ts / 2];

  // O mapa novo do jogo (desenhado à mão) não tem salas fechadas.
  assert.equal(raw.rooms.length, 0, 'mapa do jogo sem salas fechadas');
  assert.equal(roomIdAtWorld(raw, ...center(17, 11)), null, 'spawn não está em sala');
  assert.equal(roomIdAtWorld(raw, ...center(5, 15)), null, 'nenhuma célula está em sala');
});
