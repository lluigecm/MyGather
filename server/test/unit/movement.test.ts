// Unitário: validação de movimento no servidor (Fase 2, item 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MovementValidator,
  isAreaFree,
  isSolidAt,
  type TileMap,
  type TileType,
} from '../../src/movement.js';

// '.' = floor, '#' = wall, 'o' = object. Tiles de 32px.
function mk(rows: string[]): TileMap {
  const tiles: TileType[][] = rows.map((r) =>
    [...r].map((ch) => (ch === '#' ? 'wall' : ch === 'o' ? 'object' : 'floor'))
  );
  return { tileSize: 32, width: rows[0].length, height: rows.length, tiles };
}

// 30x3 tiles: corredor livre na linha 2 para exercitar velocidade sem bordas.
const MAP = mk(['.'.repeat(30), '.#o' + '.'.repeat(27), '.'.repeat(30)]);
const LANE_Y = 68; // centro da linha 2
const LIMITS = { maxSpeed: 240, maxBurst: 48 };
const AVATAR = 24;
const at = (col: number, row: number): { x: number; y: number } => ({ x: col * 32 + 4, y: row * 32 + 4 });

test('colisão: floor livre, wall e object bloqueados', () => {
  assert.equal(isAreaFree(MAP, at(0, 0).x, at(0, 0).y, AVATAR, AVATAR), true);
  assert.equal(isAreaFree(MAP, at(1, 1).x, at(1, 1).y, AVATAR, AVATAR), false); // wall
  assert.equal(isAreaFree(MAP, at(2, 1).x, at(2, 1).y, AVATAR, AVATAR), false); // object
});

test('colisão: fora do mapa e coordenadas inválidas são bloqueadas', () => {
  assert.equal(isAreaFree(MAP, -10, 0, AVATAR, AVATAR), false);
  assert.equal(isAreaFree(MAP, 0, 9999, AVATAR, AVATAR), false);
  assert.equal(isAreaFree(MAP, Number.NaN, 0, AVATAR, AVATAR), false);
  assert.equal(isSolidAt(MAP, -1, 0), true);
  assert.equal(isSolidAt(MAP, 99, 0), true);
});

test('colisão: convenção de borda (encostar é ok, invadir 1px não)', () => {
  // Tile 1 vai de x=32 a 63; hitbox termina em x+23. x=8 => 8..31 (tile 0).
  assert.equal(isAreaFree(MAP, 8, 4, AVATAR, AVATAR), true);
  assert.equal(isAreaFree(MAP, 12, 36, AVATAR, AVATAR), false);
});

test('velocidade: passo curto aceito, teleporte rejeitado', () => {
  const t0 = 1_000_000;
  const v = new MovementValidator(LIMITS, t0);
  assert.equal(v.validate({ x: 100, y: LANE_Y }, { x: 108, y: LANE_Y }, MAP, AVATAR, t0 + 40).ok, true);

  const v2 = new MovementValidator(LIMITS, t0);
  const r = v2.validate({ x: 100, y: LANE_Y }, { x: 900, y: LANE_Y }, MAP, AVATAR, t0 + 40);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'speed');
});

test('velocidade: rajada instantânea limitada ao burst', () => {
  const t0 = 1_000_000;
  const v = new MovementValidator(LIMITS, t0);
  let pos = { x: 100, y: LANE_Y };
  let accepted = 0;
  for (let i = 0; i < 60; i++) {
    const next = { x: pos.x + 8, y: LANE_Y };
    if (v.validate(pos, next, MAP, AVATAR, t0).ok) {
      pos = next;
      accepted++;
    }
  }
  assert.ok(accepted * 8 <= LIMITS.maxBurst + 0.1, `andou ${accepted * 8}px (teto ${LIMITS.maxBurst})`);
});

test('velocidade: orçamento recarrega com o tempo, sem crédito de ausência longa', () => {
  const t0 = 1_000_000;
  const v = new MovementValidator(LIMITS, t0);
  assert.equal(v.validate({ x: 100, y: LANE_Y }, { x: 148, y: LANE_Y }, MAP, AVATAR, t0).ok, true); // gasta 48
  assert.equal(v.validate({ x: 148, y: LANE_Y }, { x: 168, y: LANE_Y }, MAP, AVATAR, t0).ok, false); // sem tempo
  assert.equal(v.validate({ x: 148, y: LANE_Y }, { x: 168, y: LANE_Y }, MAP, AVATAR, t0 + 200).ok, true);

  const v2 = new MovementValidator(LIMITS, t0);
  v2.validate({ x: 100, y: LANE_Y }, { x: 148, y: LANE_Y }, MAP, AVATAR, t0);
  const long = v2.validate({ x: 148, y: LANE_Y }, { x: 900, y: LANE_Y }, MAP, AVATAR, t0 + 60_000);
  assert.equal(long.ok, false); // recarga limitada a 1s
});

test('colisão no validador: rejeita parede e não penaliza o próximo movimento', () => {
  const t0 = 2_000_000;
  const v = new MovementValidator(LIMITS, t0);
  const intoWall = v.validate(at(0, 1), at(1, 1), MAP, AVATAR, t0 + 200);
  assert.equal(intoWall.ok, false);
  assert.equal(intoWall.ok === false && intoWall.reason, 'collision');
  // Rejeição não consome orçamento: um movimento válido logo depois é aceito.
  assert.equal(v.validate(at(0, 1), at(0, 0), MAP, AVATAR, t0 + 200).ok, true);
});

test('entradas inválidas (NaN/Infinity) são rejeitadas', () => {
  const t0 = 3_000_000;
  const v = new MovementValidator(LIMITS, t0);
  const nan = v.validate({ x: 100, y: LANE_Y }, { x: Number.NaN, y: 5 }, MAP, AVATAR, t0 + 100);
  assert.equal(nan.ok === false && nan.reason, 'invalid');
  const inf = v.validate({ x: 100, y: LANE_Y }, { x: Infinity, y: 5 }, MAP, AVATAR, t0 + 100);
  assert.equal(inf.ok === false && inf.reason, 'invalid');
});
