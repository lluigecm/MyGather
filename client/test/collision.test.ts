// Unitário (Etapa 1): colisão AABB do cliente (moveWithCollision).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  moveWithCollision,
  isSolidAt,
  isSolidType,
  type MapData,
  type TileType,
} from '../src/collision.js';

function mk(rows: string[]): MapData {
  const tiles: TileType[][] = rows.map((r) =>
    [...r].map((ch) => (ch === '#' ? 'wall' : ch === 'o' ? 'object' : 'floor'))
  );
  return { tileSize: 32, width: rows[0].length, height: rows.length, spawn: { x: 0, y: 0 }, tiles };
}
const SIZE = 24;

test('isSolidType/isSolidAt: wall e object sólidos, floor não, fora do mapa sólido', () => {
  assert.equal(isSolidType('wall'), true);
  assert.equal(isSolidType('object'), true);
  assert.equal(isSolidType('floor'), false);
  const m = mk(['.#', 'o.']);
  assert.equal(isSolidAt(m, 1, 0), true);
  assert.equal(isSolidAt(m, 0, 1), true);
  assert.equal(isSolidAt(m, 0, 0), false);
  assert.equal(isSolidAt(m, -1, 0), true, 'fora do mapa');
  assert.equal(isSolidAt(m, 99, 0), true);
});

test('move livre: avança a distância pedida', () => {
  const m = mk(['....', '....', '....']);
  const r = moveWithCollision(m, { x: 4, y: 4, w: SIZE, h: SIZE }, 10, 0);
  assert.equal(r.x, 14);
  assert.equal(r.y, 4);
});

// Passo ≤ tileSize, como no movimento real (a função assume isso).
const STEP = 30;

test('bate na parede à direita: encosta sem invadir', () => {
  const m = mk(['....', '..#.', '....']); // wall no tile (2,1)
  const y = 1 * 32 + (32 - SIZE) / 2; // centrado na linha 1
  const r = moveWithCollision(m, { x: 1 * 32, y, w: SIZE, h: SIZE }, STEP, 0);
  // Encosta na borda esquerda do tile 2: x = 2*32 - SIZE = 40.
  assert.equal(r.x, 2 * 32 - SIZE);
  assert.equal(isSolidAt(m, Math.floor((r.x + SIZE - 1) / 32), 1), false, 'não invadiu a parede');
  assert.equal(isSolidAt(m, Math.floor((r.x + SIZE) / 32), 1), true, 'a parede está 1px à frente');
});

test('resolução por eixo permite deslizar ao longo da parede', () => {
  // Parede vertical em col 2; movimento diagonal deve deslizar na vertical.
  const m = mk(['..#.', '..#.', '..#.']);
  const y = 0 + (32 - SIZE) / 2;
  const r = moveWithCollision(m, { x: 1 * 32, y, w: SIZE, h: SIZE }, STEP, 20);
  assert.equal(r.x, 2 * 32 - SIZE, 'barrado no eixo X');
  assert.equal(r.y, y + 20, 'deslizou no eixo Y');
});
