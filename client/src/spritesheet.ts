// Parsing de spritesheet LPC (Etapa 8).
//
// O gerador Universal-LPC exporta um sheet de frames 64×64, 13 colunas, com
// blocos de animação empilhados. O bloco de WALK fica nas linhas 8–11, uma por
// direção (Norte, Oeste, Sul, Leste), com 9 frames: o frame 0 é o idle daquela
// direção e os frames 1–8 são o ciclo de caminhada.

export type Direction = 'north' | 'south' | 'east' | 'west';

/** Retângulo de origem (na imagem) de um frame. */
export interface FrameRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

const FRAME = 64; // px por frame no sheet LPC

// Linha do bloco de walk por direção (layout padrão do gerador LPC).
const WALK_ROW: Record<Direction, number> = {
  north: 8,
  west: 9,
  south: 10,
  east: 11,
};

const WALK_FRAMES = 8; // colunas 1..8 (a coluna 0 é o idle)

export class CharacterSprite {
  readonly frameSize = FRAME;

  constructor(readonly image: HTMLImageElement) {}

  private rect(row: number, col: number): FrameRect {
    return { sx: col * FRAME, sy: row * FRAME, sw: FRAME, sh: FRAME };
  }

  /** Frame parado (idle) de uma direção: coluna 0 da linha de walk. */
  idle(dir: Direction): FrameRect {
    return this.rect(WALK_ROW[dir], 0);
  }

  /**
   * Frame do ciclo de caminhada. `phase` é um índice contínuo (ex.: derivado do
   * tempo); mapeia para as colunas 1..8 em loop.
   */
  walk(dir: Direction, phase: number): FrameRect {
    const col = 1 + (((phase % WALK_FRAMES) + WALK_FRAMES) % WALK_FRAMES);
    return this.rect(WALK_ROW[dir], col);
  }
}

/** Carrega uma imagem e resolve com o CharacterSprite. Rejeita em erro. */
export function loadCharacterSprite(url: string): Promise<CharacterSprite> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(new CharacterSprite(img));
    img.onerror = () => reject(new Error(`falha ao carregar sprite: ${url}`));
    img.src = url;
  });
}
