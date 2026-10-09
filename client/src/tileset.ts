// Renderização de tiles com arte real (Etapa 8).
//
// Convenções do tileset (ver seção 8 da spec + client/src/assets/reference.png):
//   - O mapa é majoritariamente `wall` = o VAZIO sólido, desenhado como fundo
//     escuro; as salas são `floor` escavadas nesse vazio.
//   - Parede voltada ao SUL (piso logo abaixo) rende com ALTURA: face com friso
//     `2,0` (friso laranja no topo + face cinza) na célula, com o cap escuro
//     vindo do vazio/cap acima → efeito de duas fileiras (cap + face).
//   - Paredes de borda (encostadas em piso) = navy escuro; vazio profundo = quase
//     preto. Coluna 3 do sheet (transição diagonal) NÃO é usada.
// Objects rendem `floor` por baixo + móvel por cima (pipeline em canvas/editor).
// A colisão sempre vem da grade `tiles`.

import { type DecorItem, type MapData, type TileType } from './collision.js';
import { resolveTileColor } from './tilestyle.js';

const ATLAS_TILE = 32; // tamanho da célula no atlas cyberpunk

// Face da parede voltada ao sul (friso laranja no topo + face cinza).
const WALL_FACE = { col: 2, row: 0 };
// Pilar de quina (peça de frente confirmada com o usuário): topo + corpo.
const PILLAR_TOP = { col: 0, row: 0 };
const PILLAR_BODY = { col: 0, row: 1 };

// Paleta do "vazio"/parede (quando não há sprite de face aplicável).
export const VOID_DEEP = '#0b0c12'; // vazio profundo (fundo fora das salas)
const WALL_EDGE = '#343c50'; // borda de parede encostada em piso (visível)
const WALL_BEVEL = '#4b5570'; // aresta clara da parede voltada ao piso
const WALL_CAP = '#191c27'; // cap escuro no topo da face

const atlasUrl = new URL(
  './assets/tiles/pixel_cyberpunk_interior_free_1.0.1/pixel-cyberpunk-interior.png',
  import.meta.url
).href;

let atlasPromise: Promise<HTMLImageElement | null> | null = null;

/** Carrega o atlas uma vez (cacheado). Resolve null se falhar (usa fallback). */
export function loadTileset(): Promise<HTMLImageElement | null> {
  if (!atlasPromise) {
    atlasPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.warn('[tileset] atlas não carregou; usando cores sólidas.');
        resolve(null);
      };
      img.src = atlasUrl;
    });
  }
  return atlasPromise;
}

interface AtlasRef {
  col: number;
  row: number;
  w: number; // largura em tiles
  h: number; // altura em tiles
}

/** "col,row" (1×1) ou "col,row,w,h" → AtlasRef, ou null se inválido. */
export function parseAtlasRef(sprite: string | null | undefined): AtlasRef | null {
  if (!sprite) return null;
  const m = /^(\d+),(\d+)(?:,(\d+),(\d+))?$/.exec(sprite.trim());
  if (!m) return null;
  return {
    col: Number(m[1]),
    row: Number(m[2]),
    w: m[3] ? Number(m[3]) : 1,
    h: m[4] ? Number(m[4]) : 1,
  };
}

/** Tipo do tile em (col,row), ou null fora dos limites. */
function tileAt(map: MapData, col: number, row: number): TileType | null {
  if (row < 0 || col < 0 || row >= map.height || col >= map.width) return null;
  return map.tiles[row][col];
}
function isFloorish(map: MapData, col: number, row: number): boolean {
  const t = tileAt(map, col, row);
  return t === 'floor' || t === 'object';
}
/** A parede toca piso em algum dos 8 vizinhos (inclui diagonais → preenche cantos). */
function touchesFloor8(map: MapData, col: number, row: number): boolean {
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (dc === 0 && dr === 0) continue;
      if (isFloorish(map, col + dc, row + dr)) return true;
    }
  return false;
}
/** Quina externa: parede que toca piso só na DIAGONAL (nenhum piso ortogonal). */
function isOuterCorner(map: MapData, col: number, row: number): boolean {
  const ortho =
    isFloorish(map, col, row - 1) ||
    isFloorish(map, col, row + 1) ||
    isFloorish(map, col - 1, row) ||
    isFloorish(map, col + 1, row);
  const diag =
    isFloorish(map, col - 1, row - 1) ||
    isFloorish(map, col + 1, row - 1) ||
    isFloorish(map, col - 1, row + 1) ||
    isFloorish(map, col + 1, row + 1);
  return !ortho && diag;
}

/** Desenha uma célula do atlas (col,row em tiles) num retângulo de tela `size`. */
function blit(
  ctx: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  col: number,
  row: number,
  dx: number,
  dy: number,
  size: number
): void {
  ctx.drawImage(atlas, col * ATLAS_TILE, row * ATLAS_TILE, ATLAS_TILE, ATLAS_TILE, dx, dy, size, size);
}

/**
 * Desenha um tile de PISO ou OBJECT em (dx,dy). Paredes NÃO passam por aqui —
 * elas são desenhadas por `drawWallCell` (render de 2 tiles de altura). Se não
 * houver atlas/sprite, cai no fallback de cor sólida.
 */
export function drawTile(
  ctx: CanvasRenderingContext2D,
  atlas: HTMLImageElement | null,
  map: MapData,
  type: TileType,
  _col: number,
  _row: number,
  dx: number,
  dy: number,
  size: number
): void {
  const ref = parseAtlasRef(map.tileStyles?.[type]?.sprite);
  if (!atlas || !ref) {
    ctx.fillStyle = resolveTileColor(map, type);
    ctx.fillRect(dx, dy, size, size);
    return;
  }
  blit(ctx, atlas, ref.col, ref.row, dx, dy, size);
}

/**
 * Desenha uma célula de PAREDE. O mapa é o VAZIO sólido; as paredes encostadas
 * em piso viram a borda das salas. Regras:
 *   - vazio profundo (nenhum piso vizinho) → quase preto;
 *   - borda de parede → navy escuro;
 *   - parede voltada ao SUL (piso logo abaixo) → face com friso `2,0` na célula,
 *     e um cap escuro na fileira de cima (dá o efeito de 2 fileiras: cap + face).
 * `dx,dy` é o canto superior-esquerdo da célula. Deve ser chamada DEPOIS do
 * piso/objeto da mesma linha para o cap ocluir corretamente o vizinho de cima.
 */
export function drawWallCell(
  ctx: CanvasRenderingContext2D,
  atlas: HTMLImageElement | null,
  map: MapData,
  col: number,
  row: number,
  dx: number,
  dy: number,
  size: number
): void {
  // Base: navy nas bordas de sala (inclui cantos via 8-dir), quase preto no
  // vazio profundo. O 8-dir preenche as células de canto que antes ficavam pretas.
  const border = touchesFloor8(map, col, row);
  ctx.fillStyle = border ? WALL_EDGE : VOID_DEEP;
  ctx.fillRect(dx, dy, size, size);

  const floorSouth = isFloorish(map, col, row + 1);

  if (atlas && floorSouth) {
    // Parede voltada ao SUL: face com friso `2,0`. O vazio/parede acima já faz
    // de cap escuro; só há piso TAMBÉM ao norte (divisória) desenhamos um cap.
    if (isFloorish(map, col, row - 1)) {
      ctx.fillStyle = WALL_CAP;
      ctx.fillRect(dx, dy - Math.round(size * 0.5), size, Math.round(size * 0.5));
    }
    blit(ctx, atlas, WALL_FACE.col, WALL_FACE.row, dx, dy, size);
  } else if (border) {
    // Parede lateral/inferior (sem face): aresta clara no lado que encara o piso,
    // para a parede LER como parede (não se perder no fundo escuro).
    const lip = Math.max(2, Math.round(size * 0.09));
    ctx.fillStyle = WALL_BEVEL;
    if (isFloorish(map, col, row - 1)) ctx.fillRect(dx, dy, size, lip);
    if (isFloorish(map, col, row + 1)) ctx.fillRect(dx, dy + size - lip, size, lip);
    if (isFloorish(map, col - 1, row)) ctx.fillRect(dx, dy, lip, size);
    if (isFloorish(map, col + 1, row)) ctx.fillRect(dx + size - lip, dy, lip, size);
  }

  // Pilar de quina nas quinas externas das salas (evita silhueta recortada).
  if (atlas && isOuterCorner(map, col, row)) {
    blit(ctx, atlas, PILLAR_BODY.col, PILLAR_BODY.row, dx, dy, size);
    if (!isFloorish(map, col, row + 1)) {
      blit(ctx, atlas, PILLAR_TOP.col, PILLAR_TOP.row, dx, dy - size, size);
    }
  }
}

/**
 * Desenha um item de decoração (móvel) em (dx,dy) — canto superior-esquerdo do
 * tile de origem na tela. Peças de vários tiles usam "col,row,w,h".
 */
export function drawDecor(
  ctx: CanvasRenderingContext2D,
  atlas: HTMLImageElement | null,
  item: DecorItem,
  dx: number,
  dy: number,
  tileSize: number
): void {
  const ref = parseAtlasRef(item.sprite);
  if (!atlas || !ref) return;
  ctx.drawImage(
    atlas,
    ref.col * ATLAS_TILE,
    ref.row * ATLAS_TILE,
    ref.w * ATLAS_TILE,
    ref.h * ATLAS_TILE,
    dx,
    dy,
    ref.w * tileSize,
    ref.h * tileSize
  );
}
