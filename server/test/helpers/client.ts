// Harness de cliente para testes de integração. Ao contrário de um socket cru,
// este cliente se MOVE legalmente (A* + passos curtos), respeitando a validação
// de movimento do servidor (velocidade + colisão). Reusa o pathfinding e o mapa
// do próprio cliente da aplicação.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { io, type Socket } from 'socket.io-client';
import { findPath, type Tile } from '../../../client/src/pathfinding.js';
import type { MapData } from '../../../client/src/collision.js';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const MAP_PATH = fileURLToPath(new URL('../../../client/src/map.json', import.meta.url));
export const MAP = JSON.parse(readFileSync(MAP_PATH, 'utf8')) as MapData;

// Mapa usado pelo pathfinding do harness. Por padrão é o mapa real do jogo, mas
// os testes de isolamento de SALA (que precisam de uma sala fechada, ausente no
// mapa real) trocam por um fixture via `useMap` — o servidor daqueles testes
// também sobe com MAP_PATH apontando pro mesmo fixture, mantendo cliente e
// servidor no MESMO mapa.
let activeMap: MapData = MAP;
export function useMap(m: MapData): void {
  activeMap = m;
}

export const AVATAR = 24;
const TS = MAP.tileSize;

/** Canto da hitbox para ficar centrada no tile (col,row). */
export const tileToPos = (col: number, row: number): { x: number; y: number } => ({
  x: col * TS + (TS - AVATAR) / 2,
  y: row * TS + (TS - AVATAR) / 2,
});
export const posToTile = (x: number, y: number): Tile => ({
  col: Math.floor((x + AVATAR / 2) / TS),
  row: Math.floor((y + AVATAR / 2) / TS),
});

// Passo do caminhar: 8px a cada 40ms = 200 px/s, abaixo do teto do servidor
// (160 * 1.5 = 240 px/s), com folga para jitter.
const STEP_PX = 8;
const STEP_MS = 40;

export interface Health {
  players: { id: string; x: number; y: number; roomId: string | null; name: string }[];
  rejections: { speed: number; collision: number; invalid: number };
}

export async function health(url: string, token?: string): Promise<Health> {
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  return (await fetch(`${url}/health${q}`)).json() as Promise<Health>;
}

export interface TestClient {
  socket: Socket;
  readonly id: string | null;
  x: number;
  y: number;
  events: { enter: string[]; leave: string[]; corrections: { x: number; y: number }[] };
  /** Conexões ATUAIS por proximidade/sala (estado, não histórico). */
  connected: Set<string>;
  /** Estado de mudo conhecido de cada peer (por id). */
  remoteMuted: Map<string, boolean>;
  msgs: { from: string; text: string; at: number }[];
  moveRaw(x: number, y: number): void;
  say(text: string): void;
  setMuted(muted: boolean): void;
  walkTo(col: number, row: number): Promise<void>;
  reset(): void;
  texts(): string[];
  disconnect(): void;
}

export async function connect(
  url: string,
  name?: string,
  sessionId?: string
): Promise<TestClient> {
  const socket = io(url, {
    ...(name ? { query: { name } } : {}),
    ...(sessionId ? { auth: { sessionId } } : {}),
  });

  const client: TestClient = {
    socket,
    id: null,
    x: 0,
    y: 0,
    events: { enter: [], leave: [], corrections: [] },
    connected: new Set<string>(),
    remoteMuted: new Map<string, boolean>(),
    msgs: [],
    moveRaw(x, y) {
      this.x = x;
      this.y = y;
      socket.emit('move', { x, y });
    },
    say(text) {
      socket.emit('chat', { text });
    },
    setMuted(muted) {
      socket.emit('mute', { muted });
    },
    async walkTo(col, row) {
      const start = posToTile(this.x, this.y);
      const path = findPath(activeMap, start, { col, row });
      if (!path) throw new Error(`sem caminho de ${JSON.stringify(start)} até (${col},${row})`);
      for (const tile of path) {
        const target = tileToPos(tile.col, tile.row);
        for (;;) {
          const dx = target.x - this.x;
          const dy = target.y - this.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= STEP_PX) {
            this.moveRaw(target.x, target.y);
            await sleep(STEP_MS);
            break;
          }
          this.moveRaw(this.x + (dx / dist) * STEP_PX, this.y + (dy / dist) * STEP_PX);
          await sleep(STEP_MS);
        }
      }
    },
    reset() {
      this.events.enter = [];
      this.events.leave = [];
      this.events.corrections = [];
      this.msgs.length = 0;
    },
    texts() {
      return this.msgs.map((m) => m.text);
    },
    disconnect() {
      socket.disconnect();
    },
  };

  socket.on(
    'welcome',
    (d: {
      id: string;
      self: { x: number; y: number };
      players: { id: string; muted: boolean }[];
    }) => {
      (client as { id: string | null }).id = d.id;
      client.x = d.self.x;
      client.y = d.self.y;
      for (const p of d.players) client.remoteMuted.set(p.id, p.muted);
    }
  );
  socket.on('player:joined', (p: { id: string; muted: boolean }) =>
    client.remoteMuted.set(p.id, p.muted)
  );
  socket.on('player:muted', (d: { id: string; muted: boolean }) =>
    client.remoteMuted.set(d.id, d.muted)
  );
  socket.on('peer:enter', (d: { id: string }) => {
    client.events.enter.push(d.id);
    client.connected.add(d.id);
  });
  socket.on('peer:leave', (d: { id: string }) => {
    client.events.leave.push(d.id);
    client.connected.delete(d.id);
  });
  socket.on('position:correction', (p: { x: number; y: number }) =>
    client.events.corrections.push(p)
  );
  socket.on('chat', (m: { from: string; text: string; at: number }) => client.msgs.push(m));

  for (let i = 0; i < 60 && !client.id; i++) await sleep(50);
  if (!client.id) throw new Error('cliente de teste não recebeu welcome');
  return client;
}
