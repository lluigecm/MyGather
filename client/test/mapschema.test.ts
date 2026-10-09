// Unitário: validação de map.json (schema compartilhado jogo ↔ editor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateMap, safeValidateMap } from '../src/mapschema.js';
import { type MapData, type TileType } from '../src/collision.js';

function mk(rows: string[], over: Partial<MapData> = {}): MapData {
  const tiles: TileType[][] = rows.map((r) =>
    [...r].map((c) => (c === '#' ? 'wall' : c === 'o' ? 'object' : 'floor'))
  );
  return {
    tileSize: 32,
    width: rows[0].length,
    height: rows.length,
    spawn: { x: 0, y: 0 },
    tiles,
    ...over,
  };
}

test('mapa mínimo válido passa (piso cercado por parede)', () => {
  const m = mk(['###', '#.#', '###'], { spawn: { x: 1, y: 1 } });
  assert.deepEqual(validateMap(m), m);
});

test('rejeita piso exposto ao vazio (na borda do mapa)', () => {
  const r = safeValidateMap(mk(['..', '..']));
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : '', /exposto ao vazio/);
});

test('o map.json real do jogo é válido', () => {
  const raw = JSON.parse(
    readFileSync(fileURLToPath(new URL('../src/map.json', import.meta.url)), 'utf8')
  );
  assert.equal(safeValidateMap(raw).ok, true);
});

test('rejeita grade com dimensão errada', () => {
  const bad = { ...mk(['..', '..']), width: 3 };
  const r = safeValidateMap(bad);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : '', /colunas/);
});

test('rejeita tipo de tile inválido', () => {
  const bad = mk(['..', '..']);
  (bad.tiles[0][0] as unknown as string) = 'lava';
  assert.equal(safeValidateMap(bad).ok, false);
});

test('rejeita spawn fora do mapa e sobre tile sólido', () => {
  assert.equal(safeValidateMap(mk(['###', '#.#', '###'], { spawn: { x: 9, y: 0 } })).ok, false);
  assert.equal(safeValidateMap(mk(['###', '#o#', '###'], { spawn: { x: 1, y: 1 } })).ok, false);
});

test('salas: válidas passam, fora dos limites são rejeitadas', () => {
  const ok = mk(['####', '#..#', '#..#', '####'], {
    spawn: { x: 1, y: 1 },
    rooms: [{ roomId: 'sala', x: 1, y: 1, width: 2, height: 2 }],
  });
  assert.equal(safeValidateMap(ok).ok, true);

  const bad = mk(['####', '#..#', '####'], {
    spawn: { x: 1, y: 1 },
    rooms: [{ roomId: 'x', x: 3, y: 0, width: 5, height: 1 }],
  });
  assert.equal(safeValidateMap(bad).ok, false);
});

test('tileStyles é opcional e aceito (sprite reservado, não obrigatório)', () => {
  const withStyles = mk(['###', '#.#', '###'], {
    spawn: { x: 1, y: 1 },
    tileStyles: {
      floor: { color: '#2e2e38', sprite: null },
      wall: { color: '#5a5a6e', sprite: 'tiles/wall.png' }, // sprite futuro: aceito
    },
  });
  assert.equal(safeValidateMap(withStyles).ok, true);

  // Sem tileStyles também é válido (mapas antigos).
  assert.equal(safeValidateMap(mk(['###', '#.#', '###'], { spawn: { x: 1, y: 1 } })).ok, true);
});

test('tileStyles com tipo inválido é rejeitado', () => {
  const bad = mk(['###', '#.#', '###'], {
    spawn: { x: 1, y: 1 },
    tileStyles: { lava: { color: '#f00' } } as unknown as MapData['tileStyles'],
  });
  assert.equal(safeValidateMap(bad).ok, false);
});
