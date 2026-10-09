// Detecção de colisão AABB entre o avatar e os tiles do mapa.
// Também concentra os tipos que descrevem o mapa (usados por canvas.ts e player.ts).

export type TileType = 'floor' | 'wall' | 'object';

/** Zona de sala fechada (Etapa 5), em coordenadas de tile. */
export interface RoomZone {
  roomId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Aparência de um tipo de tile. `color` já é usada (render sólido, como hoje).
 * `sprite` é reservado para a pixel art da Etapa 8 — preservado no arquivo,
 * mas ainda NÃO renderizado (adicioná-lo depois será incremental).
 */
export interface TileStyle {
  color?: string;
  sprite?: string | null;
}

/**
 * Item de decoração (Etapa 8): um móvel/detalhe desenhado por cima dos tiles,
 * em (x,y) de tile. `sprite` é uma referência ao atlas "col,row" ou
 * "col,row,w,h" (peças de vários tiles). É PURAMENTE visual — a colisão vem
 * sempre da grade `tiles`.
 */
export interface DecorItem {
  x: number;
  y: number;
  sprite: string;
}

/**
 * Decal montado NA FACE DA PAREDE (monitor, letreiro neon, painel, tela).
 * Mesmo formato de `DecorItem`, mas desenhado por cima das paredes (e não do
 * piso). Puramente visual — a parede já é sólida, então não altera colisão.
 */
export type WallDecal = DecorItem;

export interface MapData {
  tileSize: number;
  width: number; // colunas (em tiles)
  height: number; // linhas (em tiles)
  spawn: { x: number; y: number }; // posição inicial em coordenadas de tile
  tiles: TileType[][]; // grade [linha][coluna]
  rooms?: RoomZone[]; // zonas de sala (opcional; mapas antigos não têm)
  /** Estilo opcional por tipo de tile (cor + sprite do atlas). */
  tileStyles?: Partial<Record<TileType, TileStyle>>;
  /** Camada de móveis de CHÃO desenhada sobre o piso/objetos. */
  decor?: DecorItem[];
  /** Decals montados na FACE DA PAREDE (desenhados por cima das paredes). */
  decals?: WallDecal[];
}

/** Caixa alinhada aos eixos, em pixels do mundo. */
export interface AABB {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Tipos de tile considerados sólidos (bloqueiam o avatar). */
export function isSolidType(type: TileType): boolean {
  return type === 'wall' || type === 'object';
}

/**
 * Verifica se o tile na coordenada de grade (tileX, tileY) é sólido.
 * Fora dos limites do mapa também conta como sólido (evita sair da grade).
 */
export function isSolidAt(map: MapData, tileX: number, tileY: number): boolean {
  if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) {
    return true;
  }
  return isSolidType(map.tiles[tileY][tileX]);
}

/**
 * Move uma caixa AABB no mundo por (dx, dy) resolvendo colisão eixo a eixo.
 * Resolver por eixo permite "deslizar" ao longo de paredes.
 *
 * Assume que |dx| e |dy| por frame são menores que tileSize (verdadeiro nas
 * velocidades usadas), o que mantém a resolução AABB simples e estável.
 *
 * Retorna a nova posição (x, y) já corrigida.
 */
export function moveWithCollision(
  map: MapData,
  box: AABB,
  dx: number,
  dy: number
): { x: number; y: number } {
  const ts = map.tileSize;
  let { x, y } = box;
  const { w, h } = box;

  // --- Eixo X ---
  if (dx !== 0) {
    x += dx;
    const top = Math.floor(y / ts);
    const bottom = Math.floor((y + h - 1) / ts);
    if (dx > 0) {
      const right = Math.floor((x + w - 1) / ts);
      for (let ty = top; ty <= bottom; ty++) {
        if (isSolidAt(map, right, ty)) {
          x = right * ts - w; // encosta na borda esquerda do tile sólido
          break;
        }
      }
    } else {
      const left = Math.floor(x / ts);
      for (let ty = top; ty <= bottom; ty++) {
        if (isSolidAt(map, left, ty)) {
          x = (left + 1) * ts; // encosta na borda direita do tile sólido
          break;
        }
      }
    }
  }

  // --- Eixo Y --- (usa o x já resolvido acima)
  if (dy !== 0) {
    y += dy;
    const left = Math.floor(x / ts);
    const right = Math.floor((x + w - 1) / ts);
    if (dy > 0) {
      const bottom = Math.floor((y + h - 1) / ts);
      for (let tx = left; tx <= right; tx++) {
        if (isSolidAt(map, tx, bottom)) {
          y = bottom * ts - h; // encosta no topo do tile sólido
          break;
        }
      }
    } else {
      const top = Math.floor(y / ts);
      for (let tx = left; tx <= right; tx++) {
        if (isSolidAt(map, tx, top)) {
          y = (top + 1) * ts; // encosta na base do tile sólido
          break;
        }
      }
    }
  }

  return { x, y };
}
