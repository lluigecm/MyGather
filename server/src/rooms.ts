// Lógica de proximidade (Etapa 3) e salas fechadas (Etapa 5).
//
// Proximidade: mantém o conjunto de pares "próximos" e dispara callbacks ao
// entrar/sair de alcance, com histerese (entra em <= enterRadius, só sai em
// > leaveRadius) para evitar oscilação na borda.
//
// Salas: uma zona `room` tem precedência sobre a distância — quem está numa
// sala só se conecta a quem está na MESMA sala, e nunca a quem está fora dela
// (mesmo encostado do outro lado da parede).

export interface ProximityConfig {
  enterRadius: number; // px: entra em proximidade quando dist <= enterRadius
  leaveRadius: number; // px: sai de proximidade quando dist > leaveRadius
}

export interface Point {
  id: string;
  x: number;
  y: number;
  /** Sala em que o jogador está, ou null se estiver em área aberta. */
  roomId: string | null;
}

/** Zona de sala, em coordenadas de tile. */
export interface RoomZone {
  roomId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoomMap {
  tileSize: number;
  rooms: RoomZone[];
}

/**
 * Retorna o roomId da zona que contém o ponto (coordenadas de mundo, px),
 * ou null se o ponto não estiver em nenhuma sala.
 */
export function roomIdAtWorld(map: RoomMap, worldX: number, worldY: number): string | null {
  const col = Math.floor(worldX / map.tileSize);
  const row = Math.floor(worldY / map.tileSize);
  for (const r of map.rooms) {
    if (col >= r.x && col < r.x + r.width && row >= r.y && row < r.y + r.height) {
      return r.roomId;
    }
  }
  return null;
}

/** Callback para um par de jogadores (por id). */
export type PairHandler = (a: string, b: string) => void;

export class ProximityManager {
  // Pares atualmente próximos, como chave normalizada "a|b" (a < b).
  private near = new Set<string>();

  constructor(private readonly config: ProximityConfig) {}

  private static pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  /**
   * Recalcula a proximidade entre TODOS os pares de jogadores.
   * Dispara onEnter para pares que passaram a estar próximos e onLeave para os
   * que se afastaram além do leaveRadius.
   */
  tick(players: Point[], onEnter: PairHandler, onLeave: PairHandler): void {
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i];
        const b = players[j];
        const key = ProximityManager.pairKey(a.id, b.id);
        const isNear = this.near.has(key);
        const shouldBeNear = this.shouldConnect(a, b, isNear);

        if (!isNear && shouldBeNear) {
          this.near.add(key);
          onEnter(a.id, b.id);
        } else if (isNear && !shouldBeNear) {
          this.near.delete(key);
          onLeave(a.id, b.id);
        }
      }
    }
  }

  /**
   * Decide se um par deve estar conectado.
   *
   * Salas têm precedência sobre a distância:
   * - mesma sala   → conectados, a qualquer distância;
   * - salas ≠, ou um dentro e outro fora → nunca conectados;
   * - ambos fora de salas → proximidade por distância, com histerese.
   */
  private shouldConnect(a: Point, b: Point, currentlyNear: boolean): boolean {
    if (a.roomId !== null || b.roomId !== null) {
      return a.roomId !== null && a.roomId === b.roomId;
    }
    const dist = Math.hypot(a.x - b.x, a.y - b.y); // distância euclidiana
    // Histerese: já perto continua perto até ultrapassar leaveRadius.
    return dist <= (currentlyNear ? this.config.leaveRadius : this.config.enterRadius);
  }

  /**
   * IDs atualmente conectados a `id` — por proximidade ou por estarem na mesma
   * sala. É a mesma relação que governa o áudio, reusada pelo chat (Etapa 6).
   */
  getNearPeers(id: string): string[] {
    const peers: string[] = [];
    for (const key of this.near) {
      const [a, b] = key.split('|');
      if (a === id) peers.push(b);
      else if (b === id) peers.push(a);
    }
    return peers;
  }

  /**
   * Remove um jogador (desconexão) e dispara onLeave para cada par próximo
   * que o envolvia, para que o outro lado do par seja notificado.
   */
  removePlayer(id: string, onLeave: PairHandler): void {
    for (const key of [...this.near]) {
      const [a, b] = key.split('|');
      if (a === id || b === id) {
        this.near.delete(key);
        onLeave(a, b);
      }
    }
  }
}
