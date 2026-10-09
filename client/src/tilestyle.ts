// Paleta e resolução de cor dos tipos de tile. Módulo leve (só tipos), para
// ser compartilhado entre o jogo (canvas.ts) e o editor sem puxar rede/WebRTC.

import { type MapData, type TileType } from './collision.js';

/** Paleta padrão (usada quando o mapa não define cor em tileStyles). */
export const TILE_COLORS: Record<TileType, string> = {
  floor: '#2e2e38',
  wall: '#5a5a6e',
  object: '#7a5230',
};

/** Cor de um tile: a do mapa (tileStyles) se houver, senão a padrão. */
export function resolveTileColor(map: MapData, type: TileType): string {
  return map.tileStyles?.[type]?.color ?? TILE_COLORS[type];
}
