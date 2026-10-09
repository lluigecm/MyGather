// Lógica do avatar: estado e movimento suave seguindo um caminho (waypoints).
// O caminho é calculado por A* (ver pathfinding.ts) e definido via setPath.

import { moveWithCollision, type AABB, type MapData } from './collision.js';
import { type Tile } from './pathfinding.js';

interface Vec2 {
  x: number;
  y: number;
}

const ARRIVE_EPS = 0.5; // px: distância para considerar um waypoint alcançado

export class Player {
  x: number; // posição no mundo (px), canto superior esquerdo da hitbox
  y: number;
  readonly width: number;
  readonly height: number;
  readonly speed: number; // px por segundo

  // Caminho atual como pontos-centro (mundo) dos tiles a percorrer.
  private waypoints: Vec2[] | null = null;
  private wpIndex = 0;

  constructor(
    startX: number,
    startY: number,
    options: { width?: number; height?: number; speed?: number } = {}
  ) {
    this.x = startX;
    this.y = startY;
    this.width = options.width ?? 24;
    this.height = options.height ?? 24;
    this.speed = options.speed ?? 160;
  }

  /** Cria o avatar já posicionado (centralizado) no spawn definido no mapa. */
  static fromSpawn(map: MapData): Player {
    const w = 24;
    const h = 24;
    const x = map.spawn.x * map.tileSize + (map.tileSize - w) / 2;
    const y = map.spawn.y * map.tileSize + (map.tileSize - h) / 2;
    return new Player(x, y, { width: w, height: h });
  }

  getAABB(): AABB {
    return { x: this.x, y: this.y, w: this.width, h: this.height };
  }

  /** Coordenada de tile (col,row) onde o centro do avatar está agora. */
  getCurrentTile(map: MapData): Tile {
    const cx = this.x + this.width / 2;
    const cy = this.y + this.height / 2;
    return { col: Math.floor(cx / map.tileSize), row: Math.floor(cy / map.tileSize) };
  }

  get isMoving(): boolean {
    return this.waypoints !== null;
  }

  /**
   * Define um novo caminho a partir de uma lista de tiles (A*). Substitui
   * qualquer caminho em andamento — isso é o que faz um novo clique cancelar e
   * recalcular o trajeto. Lista vazia limpa o caminho.
   */
  setPath(tilePath: Tile[], map: MapData): void {
    if (tilePath.length === 0) {
      this.clearPath();
      return;
    }
    const ts = map.tileSize;
    this.waypoints = tilePath.map((t) => ({
      x: t.col * ts + ts / 2,
      y: t.row * ts + ts / 2,
    }));
    this.wpIndex = 0;
  }

  clearPath(): void {
    this.waypoints = null;
    this.wpIndex = 0;
  }

  /** Waypoints ainda não alcançados (centros no mundo), para renderização. */
  getRemainingWaypoints(): Vec2[] {
    if (!this.waypoints) return [];
    return this.waypoints.slice(this.wpIndex);
  }

  /**
   * Avança ao longo do caminho conforme o tempo decorrido (dt em segundos),
   * na velocidade fixa (px/s). O movimento é suave (subpixel/frame), não por
   * tile inteiro, e cada passo passa pela resolução de colisão como rede de
   * segurança — o caminho já evita wall/object por construção.
   */
  update(dt: number, map: MapData): void {
    if (!this.waypoints) return;

    let budget = this.speed * dt; // distância disponível neste frame

    while (this.waypoints && this.wpIndex < this.waypoints.length && budget > 0) {
      const wp = this.waypoints[this.wpIndex];
      const targetX = wp.x - this.width / 2; // canto da hitbox centralizado no tile
      const targetY = wp.y - this.height / 2;
      const dx = targetX - this.x;
      const dy = targetY - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= ARRIVE_EPS || dist <= budget) {
        // Alcança o waypoint neste frame.
        const resolved = moveWithCollision(map, this.getAABB(), dx, dy);
        this.x = resolved.x;
        this.y = resolved.y;
        budget -= dist;
        this.wpIndex++;
      } else {
        // Avança parcialmente em direção ao waypoint.
        const step = budget;
        const resolved = moveWithCollision(
          map,
          this.getAABB(),
          (dx / dist) * step,
          (dy / dist) * step
        );
        this.x = resolved.x;
        this.y = resolved.y;
        budget = 0;
      }
    }

    // Chegou ao fim do caminho.
    if (this.waypoints && this.wpIndex >= this.waypoints.length) {
      this.clearPath();
    }
  }
}
