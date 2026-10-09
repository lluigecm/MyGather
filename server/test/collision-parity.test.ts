// Teste de PARIDADE entre a colisão do cliente e a do servidor.
//
// São duas implementações distintas da mesma regra:
//   - cliente: moveWithCollision (client/src/collision.ts) — resolve o passo e
//     "encosta" o avatar na borda do tile sólido;
//   - servidor: isAreaFree (server/src/movement.ts) — decide se uma posição é
//     ocupável.
//
// A propriedade cruzada: onde o CLIENTE para ao empurrar contra uma parede tem
// de ser EXATAMENTE a última posição que o SERVIDOR considera livre — e um
// pixel além, bloqueada. Se qualquer um dos lados mudar a convenção de borda
// (o `+ w - 1`, por exemplo), um destes casos falha. Nenhuma fórmula é
// compartilhada aqui: os dois códigos reais são exercitados e comparados.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  moveWithCollision,
  type MapData,
  type TileType,
} from '../../client/src/collision.js';
import { isAreaFree, type TileMap } from '../src/movement.js';

const TS = 32;

// '.' = floor, '#' = wall. Constrói tanto o MapData (cliente) quanto o
// TileMap (servidor) a partir da mesma arte ASCII.
function build(rows: string[]): { clientMap: MapData; serverMap: TileMap } {
  const tiles: TileType[][] = rows.map((r) => [...r].map((c) => (c === '#' ? 'wall' : 'floor')));
  const width = rows[0].length;
  const height = rows.length;
  return {
    clientMap: { tileSize: TS, width, height, spawn: { x: 0, y: 0 }, tiles },
    serverMap: { tileSize: TS, width, height, tiles },
  };
}

const SIZES = [20, 24, 30]; // várias dimensões de hitbox pegam off-by-one por tamanho

// Desliza o avatar (via cliente) na direção unitária (dirX,dirY) em passos
// curtos até ele parar contra a parede. Passos curtos porque moveWithCollision
// assume deslocamento por frame menor que um tile (é o caso no jogo real).
function pushInto(
  clientMap: MapData,
  startX: number,
  startY: number,
  size: number,
  dirX: number,
  dirY: number
): { x: number; y: number } {
  const STEP = 8;
  let x = startX;
  let y = startY;
  for (let i = 0; i < 100_000; i++) {
    const r = moveWithCollision(clientMap, { x, y, w: size, h: size }, dirX * STEP, dirY * STEP);
    if (Math.abs(r.x - x) < 1e-9 && Math.abs(r.y - y) < 1e-9) break; // convergiu
    x = r.x;
    y = r.y;
  }
  return { x, y };
}

test('paridade →: cliente encosta na última coluna livre do servidor', () => {
  // Parede na coluna 6; linha 1 livre à esquerda.
  const { clientMap, serverMap } = build([
    '..........',
    '......#...',
    '..........',
  ]);
  for (const s of SIZES) {
    const y = 1 * TS + (TS - s) / 2; // centrado na linha 1
    const stop = pushInto(clientMap, 1 * TS, y, s, 1, 0);
    assert.equal(isAreaFree(serverMap, stop.x, stop.y, s, s), true, `s=${s}: parada é livre`);
    assert.equal(isAreaFree(serverMap, stop.x + 1, stop.y, s, s), false, `s=${s}: +1px bloqueia`);
  }
});

test('paridade ←: cliente encosta na última coluna livre do servidor', () => {
  const { clientMap, serverMap } = build([
    '..........',
    '...#......',
    '..........',
  ]);
  for (const s of SIZES) {
    const y = 1 * TS + (TS - s) / 2;
    const stop = pushInto(clientMap, 8 * TS, y, s, -1, 0);
    assert.equal(isAreaFree(serverMap, stop.x, stop.y, s, s), true, `s=${s}: parada é livre`);
    assert.equal(isAreaFree(serverMap, stop.x - 1, stop.y, s, s), false, `s=${s}: -1px bloqueia`);
  }
});

test('paridade ↓: cliente encosta na última linha livre do servidor', () => {
  const { clientMap, serverMap } = build([
    '.....',
    '.....',
    '.....',
    '.#...',
    '.....',
  ]);
  for (const s of SIZES) {
    const x = 1 * TS + (TS - s) / 2; // centrado na coluna 1
    const stop = pushInto(clientMap, x, 0, s, 0, 1);
    assert.equal(isAreaFree(serverMap, stop.x, stop.y, s, s), true, `s=${s}: parada é livre`);
    assert.equal(isAreaFree(serverMap, stop.x, stop.y + 1, s, s), false, `s=${s}: +1px bloqueia`);
  }
});

test('paridade ↑: cliente encosta na última linha livre do servidor', () => {
  const { clientMap, serverMap } = build([
    '.....',
    '.#...',
    '.....',
    '.....',
    '.....',
  ]);
  for (const s of SIZES) {
    const x = 1 * TS + (TS - s) / 2;
    const stop = pushInto(clientMap, x, 4 * TS, s, 0, -1);
    assert.equal(isAreaFree(serverMap, stop.x, stop.y, s, s), true, `s=${s}: parada é livre`);
    assert.equal(isAreaFree(serverMap, stop.x, stop.y - 1, s, s), false, `s=${s}: -1px bloqueia`);
  }
});

test('paridade: varredura fina de posições concorda com a colisão do cliente', () => {
  // Para cada x sub-tile perto de uma parede, a decisão do servidor (livre?)
  // deve bater com a do cliente (o passo unitário para dentro é absorvido?).
  const { clientMap, serverMap } = build(['..........', '......#...', '..........']);
  const s = 24;
  const y = 1 * TS + (TS - s) / 2;
  for (let x = 4 * TS; x < 6 * TS + s; x++) {
    const serverFree = isAreaFree(serverMap, x, y, s, s);
    // Cliente: partindo de x, um passo de +1px fica onde? Se x já é inválido,
    // não faz sentido; só comparamos posições que o servidor aceita como base.
    if (!serverFree) continue;
    // Um ÚNICO passo de +1px pelo cliente (não deslizar até o fim).
    const moved = moveWithCollision(clientMap, { x, y, w: s, h: s }, 1, 0);
    // Se o próximo pixel invade a parede, o cliente NÃO pode ter avançado.
    const nextFree = isAreaFree(serverMap, x + 1, y, s, s);
    if (!nextFree) {
      assert.equal(moved.x, x, `x=${x}: cliente barra o passo que o servidor bloquearia`);
    } else {
      assert.equal(moved.x, x + 1, `x=${x}: cliente avança onde o servidor permite`);
    }
  }
});

test('paridade no MAPA REAL do jogo: cliente para exatamente onde o servidor bloqueia', () => {
  const raw = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../client/src/map.json', import.meta.url)), 'utf8')
  ) as MapData & TileMap;
  const s = 24;
  let checked = 0;
  for (let row = 0; row < raw.height; row++) {
    for (let col = 0; col < raw.width; col++) {
      if (raw.tiles[row][col] !== 'floor') continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = col + dx, ny = row + dy;
        if (nx < 0 || ny < 0 || nx >= raw.width || ny >= raw.height) continue;
        if (raw.tiles[ny][nx] !== 'wall') continue; // só fronteiras floor→wall
        const startX = col * TS + (TS - s) / 2;
        const startY = row * TS + (TS - s) / 2;
        const stop = pushInto(raw, startX, startY, s, dx, dy);
        assert.equal(isAreaFree(raw, stop.x, stop.y, s, s), true, `(${col},${row})→(${dx},${dy}): parada livre`);
        assert.equal(
          isAreaFree(raw, stop.x + dx, stop.y + dy, s, s),
          false,
          `(${col},${row})→(${dx},${dy}): +1px invade a parede`
        );
        checked++;
      }
    }
  }
  assert.ok(checked > 50, `exercitou muitas fronteiras reais (${checked})`);
});
