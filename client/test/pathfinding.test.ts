// Unitário (Etapa 1): A* sobre a grade de tiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findPath, type Tile } from '../src/pathfinding.js';
import { isSolidAt, type MapData, type TileType } from '../src/collision.js';

// '.' = floor, '#' = wall, 'o' = object
function mk(rows: string[]): MapData {
  const tiles: TileType[][] = rows.map((r) =>
    [...r].map((ch) => (ch === '#' ? 'wall' : ch === 'o' ? 'object' : 'floor'))
  );
  return { tileSize: 32, width: rows[0].length, height: rows.length, spawn: { x: 1, y: 1 }, tiles };
}
const cardinal = (path: Tile[]): boolean =>
  path.every((t, i) => i === 0 || Math.abs(t.col - path[i - 1].col) + Math.abs(t.row - path[i - 1].row) === 1);
const hitsSolid = (map: MapData, path: Tile[]): boolean => path.some((t) => isSolidAt(map, t.col, t.row));

test('campo aberto: menor caminho, cardinal', () => {
  const m = mk(['.....', '.....', '.....']);
  const p = findPath(m, { col: 0, row: 0 }, { col: 4, row: 2 });
  assert.ok(p);
  assert.equal(p![0].col === 0 && p![0].row === 0, true, 'começa no start');
  assert.equal(p!.at(-1)!.col === 4 && p!.at(-1)!.row === 2, true, 'termina no goal');
  assert.equal(p!.length, 7, 'Manhattan 6 → 7 nós');
  assert.ok(cardinal(p!), 'passos cardinais (sem diagonal)');
});

test('contorna parede sem atravessar', () => {
  const m = mk(['.....', '.###.', '.....']);
  const p = findPath(m, { col: 1, row: 0 }, { col: 1, row: 2 });
  assert.ok(p);
  assert.equal(hitsSolid(m, p!), false, 'nenhum tile sólido no caminho');
  assert.ok(p!.length > 3, 'desvia (mais longo que a linha reta)');
});

test('destino bloqueado (wall/object) → null', () => {
  assert.equal(findPath(mk(['...', '.#.', '...']), { col: 0, row: 0 }, { col: 1, row: 1 }), null);
  assert.equal(findPath(mk(['.o.', '...']), { col: 0, row: 0 }, { col: 1, row: 0 }), null);
});

test('destino isolado (inalcançável) → null, sem crash', () => {
  const m = mk(['.....', '.###.', '.#.#.', '.###.', '.....']);
  assert.equal(findPath(m, { col: 0, row: 0 }, { col: 2, row: 2 }), null);
});

test('mapa real: acha caminho entre cômodos sem atravessar sólidos (cardinal)', () => {
  const raw = JSON.parse(
    readFileSync(fileURLToPath(new URL('../src/map.json', import.meta.url)), 'utf8')
  ) as MapData;
  // Do spawn no cômodo central (17,11) até o cômodo esquerdo (5,15): o A* precisa
  // achar um caminho ligando os cômodos, contornando paredes e mobília.
  const p = findPath(raw, { col: 17, row: 11 }, { col: 5, row: 15 });
  assert.ok(p, 'existe caminho entre os cômodos');
  assert.ok(p![0].col === 17 && p![0].row === 11, 'começa no start');
  assert.ok(p!.at(-1)!.col === 5 && p!.at(-1)!.row === 15, 'termina no goal');
  assert.equal(hitsSolid(raw, p!), false, 'não atravessa wall/object');
  assert.ok(cardinal(p!), 'passos cardinais');
});
