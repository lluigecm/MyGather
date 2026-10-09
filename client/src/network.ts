// Cliente Socket.io: conecta ao servidor, envia a própria posição (throttle
// ~20x/s) e mantém o estado das posições dos outros jogadores.

import { io, type Socket } from 'socket.io-client';

export interface RemotePlayer {
  id: string;
  x: number;
  y: number;
  name: string;
  muted: boolean;
  character: string;
}

// Espelha o protocolo definido em server/src/types.ts.
interface ServerToClientEvents {
  welcome: (data: {
    id: string;
    self: RemotePlayer;
    players: RemotePlayer[];
    iceServers: RTCIceServer[];
  }) => void;
  'position:correction': (pos: { x: number; y: number }) => void;
  'player:joined': (player: RemotePlayer) => void;
  'player:moved': (player: RemotePlayer) => void;
  'player:left': (data: { id: string }) => void;
  'peer:enter': (data: { id: string }) => void;
  'peer:leave': (data: { id: string }) => void;
  signal: (data: { from: string; data: unknown }) => void;
  chat: (msg: ChatMessage) => void;
  'player:renamed': (data: { id: string; name: string }) => void;
  'player:muted': (data: { id: string; muted: boolean }) => void;
  'player:character': (data: { id: string; character: string }) => void;
}
interface ClientToServerEvents {
  move: (pos: { x: number; y: number }) => void;
  signal: (data: { to: string; data: unknown }) => void;
  chat: (data: { text: string }) => void;
  rename: (data: { name: string }) => void;
  mute: (data: { muted: boolean }) => void;
  setCharacter: (data: { character: string }) => void;
}

/** Mensagem de chat vinda do servidor (Etapa 6). */
export interface ChatMessage {
  from: string;
  text: string;
  at: number;
}

/** Callbacks para quem consome os eventos de peer (ver webrtc.ts). */
export interface NetworkHandlers {
  onPeerEnter?: (peerId: string) => void;
  onPeerLeave?: (peerId: string) => void;
  onSignal?: (from: string, data: unknown) => void;
  onChat?: (msg: ChatMessage) => void;
  /**
   * O servidor é autoritativo sobre a posição: no `welcome` (spawn) e sempre
   * que uma atualização é recusada, o avatar local deve saltar para cá.
   */
  onAuthoritativePosition?: (pos: { x: number; y: number }) => void;
  /** Config ICE (STUN/TURN) recebida do servidor no welcome. */
  onIceServers?: (servers: RTCIceServer[]) => void;
  /** Conexão caiu: todo o estado remoto (peers inclusive) deve ser descartado. */
  onDisconnected?: (reason: string) => void;
  /** Token recusado pelo servidor: não adianta reconectar. */
  onAuthError?: () => void;
  /** Reconectou: novo socket.id, estado remoto reconstruído pelo `welcome`. */
  onReconnected?: () => void;
}

const SEND_INTERVAL_MS = 50; // 20x/segundo

export class Network {
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private selfId: string | null = null;

  /** Posições dos OUTROS jogadores (nunca inclui o próprio). */
  readonly remotePlayers = new Map<string, RemotePlayer>();

  /**
   * IDs de peers atualmente em proximidade (Etapa 3). Preenchido pelos eventos
   * peer:enter/peer:leave do servidor. Na Etapa 4 será o gatilho do WebRTC;
   * por ora, usado apenas para destaque visual.
   */
  readonly nearbyPeers = new Set<string>();

  private lastSentAt = 0;
  private lastSentX = Number.NaN;
  private lastSentY = Number.NaN;

  /** Nome atual, reenviado ao servidor após cada reconexão. */
  private name: string;
  private character: string;
  private hasConnectedBefore = false;

  constructor(
    url: string,
    name: string,
    character: string,
    token: string | null,
    sessionId: string,
    private readonly handlers: NetworkHandlers = {}
  ) {
    this.name = name;
    this.character = character;
    // A posição inicial NÃO vai no handshake: o servidor decide o spawn e a
    // informa no `welcome` (ver validação de movimento, Fase 2).
    this.socket = io(url, {
      query: { name, character },
      // auth é reenviado em toda (re)conexão pelo socket.io:
      //  - token: controle de acesso (item 4), ignorado se o servidor não exigir;
      //  - sessionId: religa ao estado anterior (item 7), NÃO é autenticação.
      auth: { ...(token ? { token } : {}), sessionId },
      // Reconexão automática (Etapa 7): tenta indefinidamente, com backoff.
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });

    this.socket.on('connect_error', (err: Error & { data?: { code?: string } }) => {
      if (err.data?.code === 'AUTH') {
        // Token inválido: parar de tentar reconectar e avisar a UI.
        this.socket.io.reconnection(false);
        this.socket.disconnect();
        this.handlers.onAuthError?.();
      }
      // Outros erros (servidor fora do ar etc.): deixa o socket.io reconectar.
    });

    this.socket.on('connect', () => {
      if (this.hasConnectedBefore) {
        // Reconexão: o socket.id é NOVO e o servidor recriou o jogador a partir
        // do handshake antigo. Reenvia nome/personagem e força o reenvio da posição.
        this.socket.emit('rename', { name: this.name });
        this.socket.emit('setCharacter', { character: this.character });
        this.lastSentX = Number.NaN;
        this.lastSentY = Number.NaN;
        this.lastSentAt = 0;
        this.handlers.onReconnected?.();
      }
      this.hasConnectedBefore = true;
    });

    this.socket.on('disconnect', (reason) => {
      // Todo o estado remoto some junto: os ids antigos não valem mais.
      this.selfId = null;
      this.remotePlayers.clear();
      this.nearbyPeers.clear();
      this.handlers.onDisconnected?.(reason);
    });

    this.socket.on('welcome', ({ id, self, players, iceServers }) => {
      this.selfId = id;
      for (const p of players) {
        if (p.id !== id) this.remotePlayers.set(p.id, p);
      }
      // Config ICE (STUN/TURN) antes de qualquer peer:enter.
      this.handlers.onIceServers?.(iceServers ?? []);
      // O servidor decide o spawn (e, após reconectar, a posição de retorno).
      this.handlers.onAuthoritativePosition?.({ x: self.x, y: self.y });
      this.lastSentX = self.x;
      this.lastSentY = self.y;
    });

    this.socket.on('position:correction', (pos) => {
      this.handlers.onAuthoritativePosition?.(pos);
      this.lastSentX = pos.x;
      this.lastSentY = pos.y;
    });

    this.socket.on('player:renamed', ({ id, name }) => {
      const p = this.remotePlayers.get(id);
      if (p) p.name = name;
    });

    this.socket.on('player:muted', ({ id, muted }) => {
      const p = this.remotePlayers.get(id);
      if (p) p.muted = muted;
    });

    this.socket.on('player:character', ({ id, character }) => {
      const p = this.remotePlayers.get(id);
      if (p) p.character = character;
    });

    this.socket.on('player:joined', (p) => {
      if (p.id !== this.selfId) this.remotePlayers.set(p.id, p);
    });

    this.socket.on('player:moved', (p) => {
      if (p.id === this.selfId) return;
      const existing = this.remotePlayers.get(p.id);
      if (existing) {
        existing.x = p.x;
        existing.y = p.y;
      } else {
        this.remotePlayers.set(p.id, p);
      }
    });

    this.socket.on('player:left', ({ id }) => {
      this.remotePlayers.delete(id);
      if (this.nearbyPeers.delete(id)) this.handlers.onPeerLeave?.(id);
    });

    this.socket.on('peer:enter', ({ id }) => {
      this.nearbyPeers.add(id);
      this.handlers.onPeerEnter?.(id);
    });
    this.socket.on('peer:leave', ({ id }) => {
      this.nearbyPeers.delete(id);
      this.handlers.onPeerLeave?.(id);
    });

    this.socket.on('signal', ({ from, data }) => {
      this.handlers.onSignal?.(from, data);
    });

    this.socket.on('chat', (msg) => {
      this.handlers.onChat?.(msg);
    });
  }

  /** Encaminha um payload de signaling WebRTC para outro peer. */
  sendSignal(to: string, data: unknown): void {
    this.socket.emit('signal', { to, data });
  }

  /** Envia uma mensagem de chat (o servidor decide quem a recebe). */
  sendChat(text: string): void {
    const clean = text.trim();
    if (clean.length === 0) return;
    this.socket.emit('chat', { text: clean });
  }

  get displayName(): string {
    return this.name;
  }

  /** Atualiza o nome exibido (persiste entre reconexões). */
  setName(name: string): void {
    const clean = name.trim();
    if (clean.length === 0) return;
    this.name = clean;
    this.socket.emit('rename', { name: clean });
  }

  /** Informa o estado do microfone (mudo = não está transmitindo). */
  setMuted(muted: boolean): void {
    this.socket.emit('mute', { muted });
  }

  /** Troca o personagem (persiste entre reconexões). */
  setCharacter(character: string): void {
    this.character = character;
    this.socket.emit('setCharacter', { character });
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  get id(): string | null {
    return this.selfId;
  }

  /**
   * Informa a posição atual ao servidor, respeitando o throttle de ~20x/s.
   * Chamável a cada frame; só emite quando o intervalo passou e a posição mudou.
   */
  sendPosition(x: number, y: number): void {
    const now = performance.now();
    if (now - this.lastSentAt < SEND_INTERVAL_MS) return;
    if (x === this.lastSentX && y === this.lastSentY) return;

    this.socket.emit('move', { x, y });
    this.lastSentAt = now;
    this.lastSentX = x;
    this.lastSentY = y;
  }
}
