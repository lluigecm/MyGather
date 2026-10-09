// Validação do map.json (schema compartilhado).
//
// Fonte única de verdade usada pelo jogo (main.ts) E pelo editor de mapas —
// assim o editor nunca exporta um mapa que o jogo rejeita. Puro (sem DOM), o
// que também permite reusá-lo em testes do lado do servidor.

import {
  isSolidType,
  type MapData,
  type TileType,
  type RoomZone,
  type TileStyle,
} from './collision.js';

const VALID_TYPES: ReadonlySet<string> = new Set<TileType>(['floor', 'wall', 'object']);

function fail(msg: string): never {
  throw new Error(`map.json inválido: ${msg}`);
}

/** Valida e estreita `data` para MapData. Lança em qualquer inconsistência. */
export function validateMap(data: unknown): MapData {
  if (typeof data !== 'object' || data === null) fail('raiz não é um objeto.');
  const m = data as Record<string, unknown>;
  const { tileSize, width, height, spawn, tiles, rooms, tileStyles, decor, decals } = m;

  if (typeof tileSize !== 'number' || tileSize <= 0) fail('"tileSize" deve ser um número positivo.');
  if (typeof width !== 'number' || typeof height !== 'number') fail('"width"/"height" devem ser números.');
  if (width <= 0 || height <= 0) fail('"width"/"height" devem ser positivos.');

  if (!Array.isArray(tiles) || tiles.length !== height) fail(`"tiles" deve ter ${height} linhas.`);
  for (let row = 0; row < height; row++) {
    const line = tiles[row];
    if (!Array.isArray(line) || line.length !== width) fail(`linha ${row} deve ter ${width} colunas.`);
    for (let col = 0; col < width; col++) {
      if (!VALID_TYPES.has(line[col])) {
        fail(`tile (${col},${row}) = "${line[col]}" não é floor/wall/object.`);
      }
    }
  }

  if (
    typeof spawn !== 'object' ||
    spawn === null ||
    typeof (spawn as Record<string, unknown>).x !== 'number' ||
    typeof (spawn as Record<string, unknown>).y !== 'number'
  ) {
    fail('"spawn" deve ter { x, y } numéricos.');
  }
  const sp = spawn as { x: number; y: number };
  if (sp.x < 0 || sp.y < 0 || sp.x >= width || sp.y >= height) fail('"spawn" está fora do mapa.');

  // Zonas de sala (opcional).
  if (rooms !== undefined) {
    if (!Array.isArray(rooms)) fail('"rooms" deve ser uma lista.');
    for (const r of rooms) {
      const z = r as Record<string, unknown>;
      const numeric = ['x', 'y', 'width', 'height'].every((k) => typeof z[k] === 'number');
      if (typeof z.roomId !== 'string' || z.roomId.length === 0 || !numeric) {
        fail(`sala ${JSON.stringify(r)} precisa de roomId (texto) e x/y/width/height numéricos.`);
      }
      const zone = r as RoomZone;
      if (zone.x < 0 || zone.y < 0 || zone.x + zone.width > width || zone.y + zone.height > height) {
        fail(`sala "${zone.roomId}" excede os limites do mapa.`);
      }
      if (zone.width <= 0 || zone.height <= 0) fail(`sala "${zone.roomId}" tem dimensão não-positiva.`);
    }
  }

  // Estilos de tile (opcional). sprite ainda não é usado, mas é validado.
  if (tileStyles !== undefined) {
    if (typeof tileStyles !== 'object' || tileStyles === null) fail('"tileStyles" deve ser um objeto.');
    for (const [key, value] of Object.entries(tileStyles as Record<string, unknown>)) {
      if (!VALID_TYPES.has(key)) fail(`"tileStyles" tem tipo inválido "${key}".`);
      const style = value as TileStyle;
      if (style.color !== undefined && typeof style.color !== 'string') fail(`cor inválida em "${key}".`);
      if (style.sprite !== undefined && style.sprite !== null && typeof style.sprite !== 'string') {
        fail(`sprite inválido em "${key}".`);
      }
    }
  }

  // Camadas visuais (opcionais): móveis de chão (`decor`) e decals de parede
  // (`decals`). Mesmo formato: lista de { x, y, sprite "col,row[,w,h]" }.
  const validateSpriteLayer = (name: string, layer: unknown): void => {
    if (layer === undefined) return;
    if (!Array.isArray(layer)) fail(`"${name}" deve ser uma lista.`);
    for (const d of layer) {
      const item = d as Record<string, unknown>;
      if (
        typeof item.x !== 'number' ||
        typeof item.y !== 'number' ||
        typeof item.sprite !== 'string' ||
        !/^\d+,\d+(,\d+,\d+)?$/.test(item.sprite)
      ) {
        fail(`${name} ${JSON.stringify(d)} precisa de x,y numéricos e sprite "col,row[,w,h]".`);
      }
      if (item.x < 0 || item.y < 0 || item.x >= width || item.y >= height) {
        fail(`${name} ${JSON.stringify(d)} está fora do mapa.`);
      }
    }
  };
  validateSpriteLayer('decor', decor);
  validateSpriteLayer('decals', decals);

  const map = data as MapData;

  // Cerco: todo tile caminhável (floor/object) precisa ter parede entre ele e o
  // vazio nos 4 lados. Como o "vazio" é tudo que está fora do mapa, isso é o
  // mesmo que exigir que nenhum floor/object encoste na borda do mapa — deve
  // haver sempre uma parede em volta. O editor mostra esse erro na UI.
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const t = map.tiles[row][col];
      if (t !== 'floor' && t !== 'object') continue;
      if (row === 0 || row === height - 1 || col === 0 || col === width - 1) {
        fail(`piso/objeto (${col},${row}) está exposto ao vazio (borda do mapa); cerque-o com parede.`);
      }
    }
  }

  // Sanidade: o spawn não pode cair num tile sólido.
  if (isSolidType(map.tiles[map.spawn.y][map.spawn.x])) fail('"spawn" está sobre um tile sólido.');

  return map;
}

export type ValidationResult = { ok: true; map: MapData } | { ok: false; error: string };

/** Versão que não lança — conveniente para o editor exibir o erro na UI. */
export function safeValidateMap(data: unknown): ValidationResult {
  try {
    return { ok: true, map: validateMap(data) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
