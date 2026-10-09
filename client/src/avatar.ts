// Animação de avatar (Etapa 8): decide direção e frame a partir do movimento.
//
// Funciona igual para o jogador local e os remotos: a cada frame recebe a
// posição atual de um avatar (por id) e, comparando com a anterior, deduz a
// direção (N/S/L/O) e se está andando. Assim não é preciso sincronizar direção
// pela rede — ela sai da própria posição já sincronizada.

import { CharacterSprite, type Direction, type FrameRect } from './spritesheet.js';

const MOVE_EPS = 0.15; // px: abaixo disso, considera-se parado
const IDLE_GRACE_MS = 140; // segura a animação de walk entre waypoints
const WALK_FRAME_MS = 110; // duração de cada frame do ciclo

interface AvatarState {
  x: number;
  y: number;
  facing: Direction;
  lastMoveAt: number;
}

export class AvatarView {
  private readonly states = new Map<string, AvatarState>();

  /** Frame a desenhar para o avatar `id` na posição (x,y) no instante `now`. */
  frame(id: string, x: number, y: number, sprite: CharacterSprite, now: number): FrameRect {
    const prev = this.states.get(id);
    let facing: Direction = prev?.facing ?? 'south';
    let lastMoveAt = prev?.lastMoveAt ?? 0;

    if (prev) {
      const dx = x - prev.x;
      const dy = y - prev.y;
      if (Math.hypot(dx, dy) > MOVE_EPS) {
        facing =
          Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : dy > 0 ? 'south' : 'north';
        lastMoveAt = now;
      }
    }

    this.states.set(id, { x, y, facing, lastMoveAt });

    const moving = now - lastMoveAt < IDLE_GRACE_MS;
    return moving ? sprite.walk(facing, Math.floor(now / WALK_FRAME_MS)) : sprite.idle(facing);
  }

  forget(id: string): void {
    this.states.delete(id);
  }
}
