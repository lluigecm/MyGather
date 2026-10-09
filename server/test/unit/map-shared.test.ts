// Validação compartilhada cliente ↔ servidor: o map.json que o SERVIDOR lê
// tem de passar pelo MESMO validador que o cliente (e o editor) usam. Assim o
// editor não pode exportar um mapa que o servidor carrega mas o jogo rejeita.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateMap } from '../../../client/src/mapschema.js';

test('o map.json usado pelo servidor é válido pelo schema compartilhado', () => {
  const path = fileURLToPath(new URL('../../../client/src/map.json', import.meta.url));
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  // Não lança → válido. Também garante que os campos que o servidor consome
  // (tiles, rooms, spawn, tileSize) estão bem-formados.
  const map = validateMap(raw);
  assert.ok(map.width > 0 && map.height > 0);
  assert.ok(Array.isArray(map.tiles) && map.tiles.length === map.height);
});
