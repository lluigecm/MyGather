// Tipos compartilhados do protocolo de rede (Etapa 2 — Multiplayer básico).

export interface Position {
  x: number;
  y: number;
}

/** Servidor ICE (STUN/TURN) enviado ao cliente para o WebRTC. */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Estado de um jogador conhecido pelo servidor. */
export interface PlayerState {
  id: string;
  x: number;
  y: number;
  /** Sala em que está (Etapa 5), ou null em área aberta. */
  roomId: string | null;
  /** Nome exibido acima do avatar (Etapa 7). */
  name: string;
  /** Microfone mudo (Fase 2, item 6): true = não está transmitindo áudio. */
  muted: boolean;
  /** Personagem escolhido (Etapa 8): id do spritesheet. */
  character: string;
}

/** Mensagem de chat (Etapa 6). Efêmera: nada é persistido. */
export interface ChatMessage {
  from: string; // id do remetente
  text: string;
  at: number; // epoch ms, atribuído pelo servidor
}

/** Eventos emitidos pelo servidor para os clientes. */
export interface ServerToClientEvents {
  // Enviado só ao cliente recém-conectado: seu id, seu estado AUTORITATIVO
  // (o servidor decide o spawn), os jogadores já presentes e a config ICE
  // (STUN/TURN) para o WebRTC — com credenciais TURN efêmeras.
  welcome: (data: {
    id: string;
    self: PlayerState;
    players: PlayerState[];
    iceServers: IceServer[];
  }) => void;
  // Fase 2: o servidor recusou uma posição — esta é a válida a ser assumida.
  'position:correction': (pos: { x: number; y: number }) => void;
  // Um novo jogador entrou.
  'player:joined': (player: PlayerState) => void;
  // Um jogador se moveu (posição atualizada).
  'player:moved': (player: PlayerState) => void;
  // Um jogador saiu (desconectou).
  'player:left': (data: { id: string }) => void;
  // Proximidade (Etapa 3): outro jogador entrou/saiu do seu alcance.
  'peer:enter': (data: { id: string }) => void;
  'peer:leave': (data: { id: string }) => void;
  // Signaling WebRTC (Etapa 4): repassa o payload do peer de origem.
  signal: (data: { from: string; data: unknown }) => void;
  // Chat (Etapa 6): mensagem recebida de alguém em alcance (ou da mesma sala).
  chat: (msg: ChatMessage) => void;
  // Polimento (Etapa 7): um jogador trocou de nome.
  'player:renamed': (data: { id: string; name: string }) => void;
  // Mudo (Fase 2, item 6): um jogador mudou o estado do microfone.
  'player:muted': (data: { id: string; muted: boolean }) => void;
  // Personagem (Etapa 8): um jogador trocou de sprite.
  'player:character': (data: { id: string; character: string }) => void;
}

/** Eventos emitidos pelos clientes para o servidor. */
export interface ClientToServerEvents {
  // Cliente informa sua posição atual (enviado com throttle ~20x/s).
  move: (pos: Position) => void;
  // Signaling WebRTC (Etapa 4): encaminhar payload para outro peer.
  signal: (data: { to: string; data: unknown }) => void;
  // Chat (Etapa 6): envia uma mensagem de texto.
  chat: (data: { text: string }) => void;
  // Polimento (Etapa 7): define/atualiza o nome exibido.
  rename: (data: { name: string }) => void;
  // Mudo (Fase 2, item 6): informa o estado do próprio microfone.
  mute: (data: { muted: boolean }) => void;
  // Personagem (Etapa 8): define/atualiza o sprite escolhido.
  setCharacter: (data: { character: string }) => void;
}
