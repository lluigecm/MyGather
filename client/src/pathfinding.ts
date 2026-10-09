// Pathfinding A* sobre a grade de tiles do mapa.
// - `floor` é nó livre; `wall`/`object` (e fora dos limites) são bloqueados.
// - 4 direções (cima/baixo/esquerda/direita) — sem diagonais.

import { isSolidAt, type MapData } from './collision.js';

export interface Tile {
  col: number;
  row: number;
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // cima
  [0, 1], // baixo
  [-1, 0], // esquerda
  [1, 0], // direita
];

/** Distância de Manhattan — heurística admissível para grade 4-direções. */
function heuristic(a: Tile, goal: Tile): number {
  return Math.abs(a.col - goal.col) + Math.abs(a.row - goal.row);
}

/**
 * Calcula o menor caminho de `start` até `goal` via A*.
 * Retorna a lista de tiles do trajeto (incluindo start e goal), ou `null`
 * se destino for bloqueado ou inalcançável. Nunca lança.
 */
export function findPath(map: MapData, start: Tile, goal: Tile): Tile[] | null {
  // Start ou goal bloqueados → sem caminho.
  if (isSolidAt(map, start.col, start.row)) return null;
  if (isSolidAt(map, goal.col, goal.row)) return null;

  const w = map.width;
  const id = (col: number, row: number): number => row * w + col;
  const startId = id(start.col, start.row);
  const goalId = id(goal.col, goal.row);

  if (startId === goalId) return [{ col: start.col, row: start.row }];

  const gScore = new Map<number, number>([[startId, 0]]);
  const fScore = new Map<number, number>([[startId, heuristic(start, goal)]]);
  const cameFrom = new Map<number, number>();
  const open: number[] = [startId];
  const openSet = new Set<number>([startId]);

  while (open.length > 0) {
    // Extrai o nó de menor fScore (varredura linear — grade pequena).
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if ((fScore.get(open[i]) ?? Infinity) < (fScore.get(open[bestIdx]) ?? Infinity)) {
        bestIdx = i;
      }
    }
    const current = open.splice(bestIdx, 1)[0];
    openSet.delete(current);

    if (current === goalId) return reconstruct(cameFrom, current, w);

    const cc = current % w;
    const cr = (current - cc) / w;
    const currentG = gScore.get(current) ?? Infinity;

    for (const [dc, dr] of NEIGHBORS) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (isSolidAt(map, nc, nr)) continue; // parede/objeto/fora do mapa

      const nId = id(nc, nr);
      const tentativeG = currentG + 1;
      if (tentativeG < (gScore.get(nId) ?? Infinity)) {
        cameFrom.set(nId, current);
        gScore.set(nId, tentativeG);
        fScore.set(nId, tentativeG + heuristic({ col: nc, row: nr }, goal));
        if (!openSet.has(nId)) {
          open.push(nId);
          openSet.add(nId);
        }
      }
    }
  }

  return null; // destino inalcançável
}

/** Refaz o caminho do goal até o start usando cameFrom e devolve start→goal. */
function reconstruct(cameFrom: Map<number, number>, goalId: number, w: number): Tile[] {
  const path: Tile[] = [];
  let cur: number | undefined = goalId;
  while (cur !== undefined) {
    const col = cur % w;
    const row = (cur - col) / w;
    path.push({ col, row });
    cur = cameFrom.get(cur);
  }
  path.reverse();
  return path;
}
