// Validação de movimento no servidor (Fase 2, item 1).
//
// O servidor deixa de confiar na posição reportada pelo cliente. Duas checagens:
//  1. VELOCIDADE — deslocamento limitado por um orçamento (px) que recarrega no
//     tempo, então nem um salto único nem uma rajada de passos pequenos
//     conseguem exceder a velocidade máxima plausível.
//  2. COLISÃO — a hitbox do avatar não pode sobrepor tile `wall`/`object` nem
//     sair do mapa. Mesma convenção do cliente (ver client/src/collision.ts).
//
// Posição rejeitada => o servidor mantém a última posição válida. Nunca
// desconecta e nunca lança.

export type TileType = 'floor' | 'wall' | 'object';

export interface TileMap {
  tileSize: number;
  width: number; // colunas
  height: number; // linhas
  tiles: TileType[][]; // [linha][coluna]
}

export interface Position {
  x: number;
  y: number;
}

export interface MovementLimits {
  /** px/s aceitos (velocidade do cliente + margem para variação de rede). */
  maxSpeed: number;
  /** Teto do orçamento acumulável, para absorver jitter sem permitir teleporte. */
  maxBurst: number;
}

export type RejectionReason = 'invalid' | 'speed' | 'collision';

export type ValidationResult = { ok: true } | { ok: false; reason: RejectionReason };

/** Tolerância para comparações de ponto flutuante. */
const EPSILON = 0.01;

export function isSolidType(type: TileType): boolean {
  return type === 'wall' || type === 'object';
}

/** Fora dos limites do mapa conta como sólido. */
export function isSolidAt(map: TileMap, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= map.width || row >= map.height) return true;
  return isSolidType(map.tiles[row][col]);
}

/**
 * A hitbox (x, y, w, h) está inteiramente sobre tiles livres?
 * Usa a mesma convenção de bordas do cliente: o tile mais à direita/abaixo é
 * floor((x + w - 1) / tileSize), para que ocupar exatamente um tile não conte
 * como invadir o vizinho.
 */
export function isAreaFree(map: TileMap, x: number, y: number, w: number, h: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  const ts = map.tileSize;
  const left = Math.floor(x / ts);
  const right = Math.floor((x + w - 1) / ts);
  const top = Math.floor(y / ts);
  const bottom = Math.floor((y + h - 1) / ts);

  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      if (isSolidAt(map, col, row)) return false;
    }
  }
  return true;
}

/**
 * Valida os movimentos de UM jogador. Mantém um orçamento de deslocamento que
 * recarrega a `maxSpeed` px/s e satura em `maxBurst` px.
 */
export class MovementValidator {
  private budget: number;
  private lastAt: number;

  constructor(
    private readonly limits: MovementLimits,
    now: number
  ) {
    this.budget = limits.maxBurst;
    this.lastAt = now;
  }

  /**
   * Decide se o jogador pode sair de `from` e chegar em `to`.
   * O orçamento só é consumido quando o movimento é aceito — quem é rejeitado
   * não fica "devendo" deslocamento.
   */
  validate(
    from: Position,
    to: Position,
    map: TileMap,
    avatarSize: number,
    now: number
  ): ValidationResult {
    // Recarrega o orçamento pelo tempo decorrido (limitado a 1s para que uma
    // ausência longa não vire crédito de teleporte).
    const elapsed = Math.min(Math.max(now - this.lastAt, 0), 1000) / 1000;
    this.lastAt = now;
    this.budget = Math.min(this.limits.maxBurst, this.budget + this.limits.maxSpeed * elapsed);

    if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) {
      return { ok: false, reason: 'invalid' };
    }

    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (distance > this.budget + EPSILON) {
      return { ok: false, reason: 'speed' };
    }

    if (!isAreaFree(map, to.x, to.y, avatarSize, avatarSize)) {
      return { ok: false, reason: 'collision' };
    }

    this.budget -= distance;
    return { ok: true };
  }
}
