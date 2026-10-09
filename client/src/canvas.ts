// Renderização no Canvas 2D: câmera que segue o avatar + desenho de mapa e avatar.

import { type MapData } from './collision.js';
import { type Player } from './player.js';
import { type RemotePlayer } from './network.js';
import { type CharacterSprite } from './spritesheet.js';
import { AvatarView } from './avatar.js';
import { drawTile, drawWallCell, drawDecor, loadTileset, VOID_DEEP } from './tileset.js';

// Jogadores remotos usam a mesma dimensão de hitbox do avatar local.
const REMOTE_SIZE = 24;

// Sprite de personagem (Etapa 8): frame 64×64, desenhado maior que o hitbox.
// Escalado em +50% (visual) — o hitbox/colisão continua o mesmo.
const SPRITE = 96; // 64 × 1.5
const SPRITE_FEET = 90; // 60 × 1.5 — y (no frame) dos pés → alinha com a base do hitbox
const HEAD_TOP = 21; // 14 × 1.5 — y (no frame) do topo da cabeça → âncora de nome/balão

/** Tudo que o renderer precisa para desenhar um quadro. */
export interface Scene {
  map: MapData;
  camera: Camera;
  player: Player;
  playerName: string;
  playerSpeaking: boolean;
  selfId: string | null;
  /** O microfone local está mudo (não transmitindo). */
  selfMuted: boolean;
  /** Personagem escolhido pelo jogador local (id). */
  selfCharacter: string;
  /** Sprites de personagem carregados, por id (para local e remotos). */
  characters: ReadonlyMap<string, CharacterSprite>;
  /**
   * Mapa (não um iterador): a cena é percorrida por mais de um passo de
   * desenho, e um `Map.values()` seria consumido no primeiro deles.
   */
  remotePlayers: ReadonlyMap<string, RemotePlayer>;
  nearbyPeers: ReadonlySet<string>;
  speakingPeers: ReadonlySet<string>;
  /** Balões de chat ativos, por id de jogador. */
  bubbles: ReadonlyMap<string, string>;
}

/** Quebra o texto em até `maxLines`, com reticências no excedente. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);

  // Se sobrou texto, corta a última linha com reticências.
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    const consumed = lines.join(' ');
    if (consumed.length < text.length) {
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = `${last}…`;
    }
  }
  return lines.length > 0 ? lines : [''];
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Câmera que segue um alvo e faz clamp nas bordas do mundo, de modo que a
 * viewport nunca mostre além dos limites do mapa quando ele é maior que a tela.
 */
export class Camera {
  x = 0;
  y = 0;

  constructor(
    public viewportWidth: number,
    public viewportHeight: number
  ) {}

  /** Atualiza o tamanho da viewport (ex.: quando o canvas é redimensionado). */
  resize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  /** Centraliza no alvo (centro da hitbox) e limita às bordas do mapa. */
  follow(targetCenterX: number, targetCenterY: number, map: MapData): void {
    const worldWidth = map.width * map.tileSize;
    const worldHeight = map.height * map.tileSize;

    let x = targetCenterX - this.viewportWidth / 2;
    let y = targetCenterY - this.viewportHeight / 2;

    // Clamp horizontal (se o mundo for menor que a viewport, centraliza).
    if (worldWidth <= this.viewportWidth) {
      x = (worldWidth - this.viewportWidth) / 2;
    } else {
      x = clamp(x, 0, worldWidth - this.viewportWidth);
    }
    if (worldHeight <= this.viewportHeight) {
      y = (worldHeight - this.viewportHeight) / 2;
    } else {
      y = clamp(y, 0, worldHeight - this.viewportHeight);
    }

    this.x = x;
    this.y = y;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly avatarView = new AvatarView();
  /** Atlas de tiles (Etapa 8). null até carregar (usa cor sólida enquanto isso). */
  private atlas: HTMLImageElement | null = null;

  /**
   * Fundo prerenderizado do mapa (tilemap Sprite Fusion desenhado em 32px/tile).
   * Quando presente, o jogo desenha ESTE fundo em vez dos type-tiles — a arte
   * (paredes, mobília, decals) já vem embutida. A colisão vem do `MapData`.
   */
  private background: HTMLImageElement | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Não foi possível obter o contexto 2D do canvas.');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    void loadTileset().then((img) => (this.atlas = img));
  }

  /** Define o fundo prerenderizado do mapa (world px = tileSize * grade). */
  setBackground(img: HTMLImageElement): void {
    this.background = img;
  }

  render(scene: Scene): void {
    const { ctx } = this;
    const { map, camera } = scene;
    const now = performance.now();
    // Fundo escuro (fora das paredes/vazio) — dá silhueta/moldura ao conjunto.
    ctx.fillStyle = VOID_DEEP;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.background) {
      // Fundo prerenderizado (tilemap): blit da janela da câmera. O mundo tem
      // origem (0,0); um ponto de mundo (wx,wy) fica na tela em (wx-cam, wy-cam).
      ctx.drawImage(this.background, Math.round(-camera.x), Math.round(-camera.y));
    } else {
      this.drawMap(map, camera);
      this.drawDecor(map, camera);
      this.drawDecals(map, camera);
    }
    this.drawRemotePlayers(scene, now);
    this.drawPlayer(scene, now);
    // Rótulos e balões por cima de todos os avatares.
    this.drawOverlays(scene);
  }

  /**
   * Desenha um avatar: sprite animado se o personagem carregou, senão um
   * retângulo de fallback. Indicadores (falando/proximidade) viram um anel na
   * base, sob o personagem.
   */
  private drawAvatar(
    scene: Scene,
    id: string,
    x: number,
    y: number,
    size: number,
    characterId: string,
    fallbackFill: string,
    fallbackStroke: string,
    speaking: boolean,
    nearby: boolean,
    now: number
  ): void {
    const { ctx } = this;
    const { camera } = scene;
    const centerX = x + size / 2 - camera.x;
    const feetY = y + size - camera.y;

    // Anel na base (proximidade e/ou falando). Dimensionado pelo sprite (não
    // pelo hitbox) e centrado nos pés, para a metade de baixo aparecer em volta
    // das pernas — o sprite é desenhado por cima.
    if (nearby || speaking) {
      ctx.save();
      ctx.lineWidth = speaking ? 3 : 2;
      ctx.strokeStyle = speaking ? '#69f0ae' : '#ffd54f';
      ctx.beginPath();
      ctx.ellipse(centerX, feetY, SPRITE * 0.3, SPRITE * 0.12, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const sprite = scene.characters.get(characterId);
    if (sprite) {
      const f = this.avatarView.frame(id, x, y, sprite, now);
      const dx = Math.round(centerX - SPRITE / 2);
      const dy = Math.round(feetY - SPRITE_FEET);
      ctx.drawImage(sprite.image, f.sx, f.sy, f.sw, f.sh, dx, dy, SPRITE, SPRITE);
    } else {
      // Fallback enquanto o sprite não carregou (ou não existe).
      const sx = Math.round(x - camera.x);
      const sy = Math.round(y - camera.y);
      ctx.fillStyle = fallbackFill;
      ctx.fillRect(sx, sy, size, size);
      ctx.strokeStyle = fallbackStroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, size - 2, size - 2);
    }
  }

  /** Desenha os avatares dos outros jogadores, atrás do avatar local. */
  private drawRemotePlayers(scene: Scene, now: number): void {
    for (const rp of scene.remotePlayers.values()) {
      this.drawAvatar(
        scene,
        rp.id,
        rp.x,
        rp.y,
        REMOTE_SIZE,
        rp.character,
        '#2196f3',
        '#0d47a1',
        scene.speakingPeers.has(rp.id),
        scene.nearbyPeers.has(rp.id),
        now
      );
    }
  }

  /** Nomes (Etapa 7) e balões de chat, ancorados acima da cabeça do avatar. */
  private drawOverlays(scene: Scene): void {
    const { camera, player, bubbles } = scene;

    interface Target {
      cx: number; // centro X na tela
      head: number; // Y do topo da cabeça na tela
      name: string;
      id: string | null;
      muted: boolean;
    }
    // Topo da cabeça: com sprite, é derivado da base; sem sprite, o topo do hitbox.
    const headTop = (worldY: number, size: number, character: string): number => {
      const feet = worldY + size - camera.y;
      return scene.characters.has(character) ? feet - SPRITE_FEET + HEAD_TOP : worldY - camera.y;
    };

    const targets: Target[] = [];
    for (const rp of scene.remotePlayers.values()) {
      targets.push({
        cx: rp.x - camera.x + REMOTE_SIZE / 2,
        head: headTop(rp.y, REMOTE_SIZE, rp.character),
        name: rp.name,
        id: rp.id,
        muted: rp.muted,
      });
    }
    targets.push({
      cx: player.x - camera.x + player.width / 2,
      head: headTop(player.y, player.width, scene.selfCharacter),
      name: scene.playerName,
      id: scene.selfId,
      muted: scene.selfMuted,
    });

    for (const t of targets) {
      this.drawName(t.name, t.cx, t.head);
      if (t.muted) this.drawMuteBadge(t.cx + 15, t.head - 4);
      const bubble = t.id ? bubbles.get(t.id) : undefined;
      if (bubble) this.drawBubble(bubble, t.cx, t.head - 16);
    }
  }

  /** Ícone de microfone mudo: círculo vermelho com um traço diagonal. */
  private drawMuteBadge(cx: number, cy: number): void {
    const { ctx } = this;
    const r = 6;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e53935';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Traço diagonal (o "corte" do mic-off).
    ctx.beginPath();
    ctx.moveTo(cx - r + 1.5, cy - r + 1.5);
    ctx.lineTo(cx + r - 1.5, cy + r - 1.5);
    ctx.stroke();
    ctx.restore();
  }

  private drawName(name: string, centerX: number, top: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    // Contorno para legibilidade sobre qualquer tile.
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(name, centerX, top - 3);
    ctx.fillStyle = '#eceff1';
    ctx.fillText(name, centerX, top - 3);
    ctx.restore();
  }

  /** Balão de chat acima do avatar, com até 2 linhas. */
  private drawBubble(text: string, centerX: number, bottom: number): void {
    const { ctx } = this;
    const MAX_WIDTH = 170;
    const PAD_X = 8;
    const PAD_Y = 5;
    const LINE_H = 14;

    ctx.save();
    ctx.font = '12px system-ui, sans-serif';
    const lines = wrapText(ctx, text, MAX_WIDTH, 2);
    const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + PAD_X * 2;
    const boxH = lines.length * LINE_H + PAD_Y * 2;
    const x = Math.round(centerX - boxW / 2);
    const y = Math.round(bottom - boxH);

    ctx.fillStyle = 'rgba(20, 20, 26, 0.92)';
    ctx.strokeStyle = 'rgba(129, 199, 132, 0.85)';
    ctx.lineWidth = 1.5;
    roundedRect(ctx, x, y, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();

    // Rabinho apontando para o avatar.
    ctx.beginPath();
    ctx.moveTo(centerX - 5, y + boxH);
    ctx.lineTo(centerX, y + boxH + 6);
    ctx.lineTo(centerX + 5, y + boxH);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#eceff1';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.fillText(line, centerX, y + PAD_Y + i * LINE_H);
    });
    ctx.restore();
  }

  /** Móveis de CHÃO desenhados sobre o piso/objetos, atrás dos avatares. */
  private drawDecor(map: MapData, camera: Camera): void {
    this.drawSpriteLayer(map.decor, map, camera);
  }

  /** Decals montados na FACE DA PAREDE (por cima das paredes), atrás dos avatares. */
  private drawDecals(map: MapData, camera: Camera): void {
    this.drawSpriteLayer(map.decals, map, camera);
  }

  private drawSpriteLayer(
    layer: MapData['decor'] | undefined,
    map: MapData,
    camera: Camera
  ): void {
    if (!this.atlas || !layer) return;
    const ts = map.tileSize;
    for (const item of layer) {
      drawDecor(
        this.ctx,
        this.atlas,
        item,
        Math.round(item.x * ts - camera.x),
        Math.round(item.y * ts - camera.y),
        ts
      );
    }
  }


  /**
   * Desenha os tiles visíveis (culling simples), em fases por linha para dar a
   * ordem de profundidade correta:
   *   1) piso (também sob os objetos → "floor por baixo do object");
   *   2) objeto (móvel sobre o piso);
   *   3) parede (2 tiles de altura; o topo ocupa a célula de cima, então precisa
   *      vir depois do piso/objeto daquela linha para ocluí-los).
   * As linhas são percorridas de cima para baixo para que uma parede ocluda o
   * vizinho de cima. O `endRow + 1` garante o topo de uma parede logo abaixo da
   * viewport.
   */
  private drawMap(map: MapData, camera: Camera): void {
    const { ctx } = this;
    const ts = map.tileSize;

    const startCol = Math.max(0, Math.floor(camera.x / ts));
    const endCol = Math.min(map.width - 1, Math.floor((camera.x + camera.viewportWidth) / ts));
    const startRow = Math.max(0, Math.floor(camera.y / ts));
    const endRow = Math.min(map.height - 1, Math.floor((camera.y + camera.viewportHeight) / ts) + 1);

    // Células com móvel próprio (decor): não desenham o sprite genérico de objeto.
    const decorCells = new Set((map.decor ?? []).map((d) => `${d.x},${d.y}`));

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const type = map.tiles[row][col];
        const sx = Math.round(col * ts - camera.x);
        const sy = Math.round(row * ts - camera.y);

        // Fase 1: piso sob piso e objetos.
        if (type === 'floor' || type === 'object') {
          drawTile(ctx, this.atlas, map, 'floor', col, row, sx, sy, ts);
        }
        // Fase 2: sprite genérico do objeto — só quando a célula não tem um
        // móvel próprio em `decor` (nesse caso o decor é a aparência do objeto).
        if (type === 'object' && !decorCells.has(`${col},${row}`)) {
          drawTile(ctx, this.atlas, map, 'object', col, row, sx, sy, ts);
        }
      }
      // Fase 3: paredes da linha (por cima do piso/objeto já desenhados). A grade
      // NÃO é desenhada no jogo — é overlay exclusivo do editor.
      for (let col = startCol; col <= endCol; col++) {
        if (map.tiles[row][col] !== 'wall') continue;
        const sx = Math.round(col * ts - camera.x);
        const sy = Math.round(row * ts - camera.y);
        drawWallCell(ctx, this.atlas, map, col, row, sx, sy, ts);
      }
    }
  }

  private drawPlayer(scene: Scene, now: number): void {
    const { player } = scene;
    this.drawAvatar(
      scene,
      '@self', // chave estável (sobrevive a reconexão) para a animação
      player.x,
      player.y,
      player.width,
      scene.selfCharacter,
      '#4caf50',
      '#1b5e20',
      scene.playerSpeaking,
      false,
      now
    );
  }
}
