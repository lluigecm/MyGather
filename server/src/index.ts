// Entrypoint do servidor: Express + Socket.io.
// Etapa 2 — sincroniza posições de jogadores em memória e as retransmite.
// (Proximidade e salas são das Etapas 3/5 — ainda não implementadas aqui.)

import express from 'express';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { buildIceServers, iceOptionsFromEnv } from './ice.js';
import { KeyedRateLimiter, TokenBucket } from './ratelimit.js';
import { SessionStore, isValidSessionId } from './sessions.js';
import type {
  ClientToServerEvents,
  PlayerState,
  ServerToClientEvents,
} from './types.js';
import { ProximityManager, roomIdAtWorld, type RoomMap } from './rooms.js';
import { MovementValidator, type TileMap } from './movement.js';

const PORT = Number(process.env.PORT ?? 3000);

// Configuração de proximidade (Etapa 3) — valores configuráveis via env.
const ENTER_RADIUS = Number(process.env.PROXIMITY_ENTER ?? 150); // px
const LEAVE_RADIUS = Number(process.env.PROXIMITY_LEAVE ?? 170); // px (histerese)
const PROXIMITY_TICK_MS = Number(process.env.PROXIMITY_TICK_MS ?? 100); // 10x/s

// Autenticação (Fase 2, item 4): token compartilhado por link. Se AUTH_TOKEN
// estiver definido, só quem apresentar o token conecta; vazio = acesso aberto.
const AUTH_TOKEN = process.env.AUTH_TOKEN ?? '';
const AUTH_ENABLED = AUTH_TOKEN.length > 0;

/** Comparação em tempo constante (evita timing attack no token). */
function tokenMatches(provided: unknown): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(AUTH_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Chat (Etapa 6): limite de tamanho para evitar payloads absurdos.
const MAX_CHAT_LENGTH = 500;
// Nomes (Etapa 7).
const MAX_NAME_LENGTH = 24;

// Personagem (Etapa 8): id de sprite. O servidor não conhece a lista de
// personagens (é do cliente); só valida o formato e limita o tamanho.
function sanitizeCharacter(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : fallback;
}

// --- CORS (Fase 2, item 5) --------------------------------------------------
// Lista de origens permitidas (separadas por vírgula). Vazio = libera geral
// (dev). Ex.: ALLOWED_ORIGINS=https://sala.empresa.com:5173
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const corsOrigin = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : '*';

// --- Rate limiting (Fase 2, item 5) -----------------------------------------
// Conexões por IP: segura brute-force de token sem bloquear um escritório atrás
// de um NAT compartilhado (rajada generosa + taxa sustentada baixa).
const connectionLimiter = new KeyedRateLimiter(
  Number(process.env.RL_CONN_RATE ?? 5), // por segundo
  Number(process.env.RL_CONN_BURST ?? 40)
);
// Limites por socket, por tipo de evento (ver criação em 'connection').
const RL_MOVE = { rate: Number(process.env.RL_MOVE_RATE ?? 30), burst: 45 }; // cliente ~20/s
const RL_CHAT = { rate: Number(process.env.RL_CHAT_RATE ?? 2), burst: 5 };
const RL_SIGNAL = { rate: Number(process.env.RL_SIGNAL_RATE ?? 40), burst: 80 }; // ICE é chatty
const rateLimited = { move: 0, chat: 0, signal: 0, connections: 0 };

// --- Reconexão preservando identidade (Fase 2, item 7) ----------------------
// Janela de carência: quanto tempo o estado de um jogador que caiu fica
// disponível para religar. Curta, para limitar a superfície de "sequestro" de
// sessão por sessionId conhecido.
const SESSION_GRACE_MS = Number(process.env.SESSION_GRACE_MS ?? 60_000);
const sessionStore = new SessionStore(SESSION_GRACE_MS);
setInterval(() => sessionStore.sweep(), SESSION_GRACE_MS).unref();

/** Normaliza um nome: sem quebras/controles, espaços colapsados e truncado. */
function sanitizeName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const clean = value
    .replace(/[\u0000-\u001F\u007F]/g, ' ') // controles viram espaço
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length === 0 ? fallback : clean.slice(0, MAX_NAME_LENGTH);
}

// Estado em memória (perde-se ao reiniciar — decisão da spec, seção 3).
const players = new Map<string, PlayerState>();

// --- Mapa (Etapa 5): o servidor precisa das zonas de sala para decidir com
// quem cada jogador se conecta. Lê o MESMO map.json usado pelo cliente.
const MAP_PATH =
  process.env.MAP_PATH ?? fileURLToPath(new URL('../../client/src/map.json', import.meta.url));

/** Mapa completo do servidor: zonas de sala + grade de tiles + spawn. */
type ServerMap = RoomMap & TileMap & { spawn: { x: number; y: number } };

function loadMap(): ServerMap {
  const fallback: ServerMap = {
    tileSize: 32,
    width: 0,
    height: 0,
    tiles: [],
    rooms: [],
    spawn: { x: 0, y: 0 },
  };
  try {
    const raw = JSON.parse(readFileSync(MAP_PATH, 'utf8')) as Partial<ServerMap>;
    const map: ServerMap = {
      tileSize: typeof raw.tileSize === 'number' ? raw.tileSize : 32,
      width: typeof raw.width === 'number' ? raw.width : 0,
      height: typeof raw.height === 'number' ? raw.height : 0,
      tiles: Array.isArray(raw.tiles) ? raw.tiles : [],
      rooms: Array.isArray(raw.rooms) ? raw.rooms : [],
      spawn: raw.spawn ?? { x: 0, y: 0 },
    };
    console.log(
      `Mapa carregado: ${map.width}x${map.height} tiles, ${map.rooms.length} sala(s) — ${MAP_PATH}`
    );
    return map;
  } catch (err) {
    // Sem mapa não há como validar colisão nem salas; o servidor segue de pé,
    // mas avisa alto, porque isso enfraquece o isolamento das salas.
    console.error(`FALHA ao ler o mapa (${MAP_PATH}). Colisão e salas DESATIVADAS.`, err);
    return fallback;
  }
}

const gameMap = loadMap();
const mapUsable = gameMap.width > 0 && gameMap.height > 0 && gameMap.tiles.length > 0;

// O avatar tem 24px; a sala é decidida pelo CENTRO da hitbox.
const AVATAR_SIZE = 24;
const AVATAR_HALF = AVATAR_SIZE / 2;
const roomAt = (x: number, y: number): string | null =>
  roomIdAtWorld(gameMap, x + AVATAR_HALF, y + AVATAR_HALF);

// --- Validação de movimento (Fase 2, item 1) --------------------------------
// A velocidade do cliente é 160 px/s (client/src/player.ts). A margem cobre
// jitter de rede e agrupamento de pacotes sem permitir teleporte.
const CLIENT_SPEED = Number(process.env.CLIENT_SPEED ?? 160);
const SPEED_TOLERANCE = Number(process.env.SPEED_TOLERANCE ?? 1.5);
const MOVEMENT_LIMITS = {
  maxSpeed: CLIENT_SPEED * SPEED_TOLERANCE,
  maxBurst: Number(process.env.MOVE_MAX_BURST ?? 48), // 1,5 tile
};
/** Intervalo mínimo entre correções enviadas ao mesmo cliente. */
const CORRECTION_THROTTLE_MS = 500;

const validators = new Map<string, MovementValidator>();
const lastCorrectionAt = new Map<string, number>();
/** Contadores só para diagnóstico (expostos em /health). */
const rejections = { speed: 0, collision: 0, invalid: 0 };

/** Posição de spawn decidida pelo SERVIDOR (o cliente não escolhe onde nasce). */
function spawnPosition(): { x: number; y: number } {
  return {
    x: gameMap.spawn.x * gameMap.tileSize + (gameMap.tileSize - AVATAR_SIZE) / 2,
    y: gameMap.spawn.y * gameMap.tileSize + (gameMap.tileSize - AVATAR_SIZE) / 2,
  };
}

// --- ICE / TURN (Fase 2, item 3) --------------------------------------------
const iceOptions = iceOptionsFromEnv();
const turnEnabled = iceOptions.turnUrls.length > 0 && !!iceOptions.turnSecret;
console.log(
  `ICE: ${iceOptions.stunUrls.length} STUN, TURN ${turnEnabled ? 'habilitado (efêmero)' : 'desabilitado'}`
);

const app = express();

// CORS dos endpoints HTTP: espelha a allowlist do Socket.io.
function originAllowed(origin: string | undefined): boolean {
  if (ALLOWED_ORIGINS.length === 0) return true;
  return origin !== undefined && ALLOWED_ORIGINS.includes(origin);
}
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.length === 0) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin as string);
    res.setHeader('Vary', 'Origin');
  }
  next();
});

app.get('/health', (req, res) => {
  // Expõe nomes/posições → exige o token quando a auth está ligada.
  if (AUTH_ENABLED && !tokenMatches(req.query.token)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  res.json({
    ok: true,
    count: players.size,
    players: [...players.values()],
    rejections,
    rateLimited,
  });
});
// Endpoint alternativo para obter credenciais ICE frescas (diagnóstico / uso
// futuro caso o cliente precise renovar credenciais sem reconectar o socket).
// Protegido pelo token quando a autenticação está ligada (as credenciais TURN
// permitem usar o relay, então não devem ser públicas).
app.get('/ice', (req, res) => {
  if (AUTH_ENABLED && !tokenMatches(req.query.token)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  res.json({ iceServers: buildIceServers(iceOptions) });
});

// --- HTTP ou HTTPS/WSS (Fase 2, item 3) -------------------------------------
// getUserMedia exige contexto seguro fora de localhost. Se TLS_CERT/TLS_KEY
// forem fornecidos, o servidor sobe em HTTPS (e o Socket.io vira WSS).
const TLS_CERT = process.env.TLS_CERT;
const TLS_KEY = process.env.TLS_KEY;
const httpServer =
  TLS_CERT && TLS_KEY
    ? createHttpsServer({ cert: readFileSync(TLS_CERT), key: readFileSync(TLS_KEY) }, app)
    : createHttpServer(app);
const secure = Boolean(TLS_CERT && TLS_KEY);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: corsOrigin },
  // Detecção de queda: configurável (padrões do socket.io). Valores baixos
  // detectam desconexão mais rápido, à custa de mais sensibilidade a hiccups.
  pingInterval: Number(process.env.PING_INTERVAL_MS ?? 25_000),
  pingTimeout: Number(process.env.PING_TIMEOUT_MS ?? 20_000),
});
console.log(
  ALLOWED_ORIGINS.length > 0
    ? `CORS: restrito a ${ALLOWED_ORIGINS.join(', ')}`
    : 'CORS: aberto (*). Defina ALLOWED_ORIGINS para restringir.'
);

// Rate limit de CONEXÕES por IP (antes da auth, para conter brute-force de
// token). Roda antes do middleware de autenticação por ser registrado antes.
io.use((socket, next) => {
  const ip = socket.handshake.address || 'desconhecido';
  if (connectionLimiter.allow(ip)) return next();
  rateLimited.connections++;
  const err = new Error('rate_limited');
  (err as Error & { data?: unknown }).data = { code: 'RATE_LIMIT' };
  next(err);
});

// Autenticação por token (Fase 2, item 4). Middleware roda antes do 'connection'.
if (AUTH_ENABLED) {
  io.use((socket, next) => {
    // Aceita o token no handshake auth (preferível) ou na query (link direto).
    const token = socket.handshake.auth?.token ?? socket.handshake.query?.token;
    if (tokenMatches(token)) return next();
    const err = new Error('unauthorized');
    // `data` chega ao cliente no connect_error → dá para distinguir de queda de
    // rede e parar de tentar reconectar.
    (err as Error & { data?: unknown }).data = { code: 'AUTH' };
    next(err);
  });
  console.log('Autenticação: token EXIGIDO');
} else {
  console.warn('Autenticação: DESABILITADA (acesso aberto). Defina AUTH_TOKEN para exigir token.');
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// --- Proximidade (Etapa 3) -------------------------------------------------
const proximity = new ProximityManager({
  enterRadius: ENTER_RADIUS,
  leaveRadius: LEAVE_RADIUS,
});

// Cada socket entra por padrão numa sala com o nome do próprio id, então
// io.to(id) atinge exatamente aquele jogador.
function emitPeerEnter(a: string, b: string): void {
  io.to(a).emit('peer:enter', { id: b });
  io.to(b).emit('peer:enter', { id: a });
}
function emitPeerLeave(a: string, b: string): void {
  io.to(a).emit('peer:leave', { id: b });
  io.to(b).emit('peer:leave', { id: a });
}

// Tick periódico: recalcula proximidade entre todos os pares.
setInterval(() => {
  proximity.tick([...players.values()], emitPeerEnter, emitPeerLeave);
}, PROXIMITY_TICK_MS);

io.on('connection', (socket) => {
  const id = socket.id; // ID único por jogador (atribuído pelo Socket.io)

  // sessionId (item 7): identificador gerado pelo cliente para religar ao
  // estado anterior. NÃO é autenticação — só chave de reconexão.
  const rawSessionId = socket.handshake.auth?.sessionId ?? socket.handshake.query?.sessionId;
  const sessionId = isValidSessionId(rawSessionId) ? rawSessionId : null;

  // Tenta restaurar o estado de uma queda recente. A posição vem do que o
  // SERVIDOR guardou (já validada) — o cliente não a envia. Se não houver,
  // nasce no spawn decidido pelo servidor (o cliente nunca escolhe a posição).
  const restored = sessionId ? sessionStore.take(sessionId) : null;
  const spawn = restored ? { x: restored.x, y: restored.y } : spawnPosition();
  const state: PlayerState = {
    id,
    x: spawn.x,
    y: spawn.y,
    roomId: roomAt(spawn.x, spawn.y),
    // Nome: prefere o do handshake (fonte de verdade do cliente); cai no
    // restaurado e por fim no genérico.
    name: sanitizeName(
      socket.handshake.query.name,
      restored?.name ?? `Convidado-${id.slice(0, 4)}`
    ),
    muted: restored?.muted ?? false, // o cliente reafirma logo após conectar
    character: sanitizeCharacter(socket.handshake.query.character, 'char-1'),
  };
  players.set(id, state);
  // Nunca logar o sessionId (nem parte): é a única defesa contra sequestro.
  if (restored) console.log(`[~] religou ${id} a uma sessão anterior`);
  validators.set(id, new MovementValidator(MOVEMENT_LIMITS, Date.now()));

  // Rate limiting por socket (Fase 2, item 5). Baldes vivem no escopo da
  // conexão → some sozinho ao desconectar.
  const moveBucket = new TokenBucket(RL_MOVE.rate, RL_MOVE.burst);
  const chatBucket = new TokenBucket(RL_CHAT.rate, RL_CHAT.burst);
  const signalBucket = new TokenBucket(RL_SIGNAL.rate, RL_SIGNAL.burst);
  console.log(`[+] conectou ${id} (${players.size} online)`);

  // Ao novo cliente: seu id + snapshot dos jogadores já presentes (exceto ele).
  socket.emit('welcome', {
    id,
    self: state, // posição autoritativa: o cliente se alinha a ela
    players: [...players.values()].filter((p) => p.id !== id),
    // Credenciais TURN efêmeras geradas AGORA (renovadas a cada (re)conexão).
    iceServers: buildIceServers(iceOptions),
  });

  // Aos demais: avisa que este jogador entrou.
  socket.broadcast.emit('player:joined', state);

  // Recebe posição e retransmite aos outros clientes conectados.
  socket.on('move', (pos) => {
    if (!moveBucket.tryConsume()) {
      rateLimited.move++;
      return;
    }
    const p = players.get(id);
    const validator = validators.get(id);
    if (!p || !validator) return;

    const target = { x: toNumber(pos?.x, Number.NaN), y: toNumber(pos?.y, Number.NaN) };
    const result = mapUsable
      ? validator.validate(p, target, gameMap, AVATAR_SIZE, Date.now())
      : ({ ok: true } as const); // sem mapa não há como validar colisão

    if (!result.ok) {
      // Mantém a última posição válida: não move, não desconecta, não lança.
      rejections[result.reason]++;
      const now = Date.now();
      if (now - (lastCorrectionAt.get(id) ?? 0) >= CORRECTION_THROTTLE_MS) {
        lastCorrectionAt.set(id, now);
        socket.emit('position:correction', { x: p.x, y: p.y });
      }
      return;
    }

    p.x = target.x;
    p.y = target.y;
    p.roomId = roomAt(p.x, p.y); // sala derivada da posição JÁ validada
    socket.broadcast.emit('player:moved', p);
  });

  // Signaling WebRTC (Etapa 4): o servidor apenas encaminha o payload opaco
  // (offer/answer/ICE) ao destinatário — não intermedia áudio/vídeo.
  socket.on('signal', ({ to, data }) => {
    if (!signalBucket.tryConsume()) {
      rateLimited.signal++;
      return;
    }
    if (!players.has(to)) return; // destinatário não está mais conectado
    io.to(to).emit('signal', { from: id, data });
  });

  // Nome (Etapa 7): atualiza e avisa todos.
  socket.on('rename', ({ name }) => {
    const p = players.get(id);
    if (!p) return;
    p.name = sanitizeName(name, p.name);
    io.emit('player:renamed', { id, name: p.name });
  });

  // Mudo (Fase 2, item 6): atualiza e avisa todos, para exibirem o ícone.
  socket.on('mute', ({ muted }) => {
    const p = players.get(id);
    if (!p) return;
    const next = Boolean(muted);
    if (p.muted === next) return; // sem mudança → não retransmite
    p.muted = next;
    io.emit('player:muted', { id, muted: next });
  });

  // Personagem (Etapa 8): atualiza e avisa todos.
  socket.on('setCharacter', ({ character }) => {
    const p = players.get(id);
    if (!p) return;
    const next = sanitizeCharacter(character, p.character);
    if (p.character === next) return;
    p.character = next;
    io.emit('player:character', { id, character: next });
  });

  // Chat (Etapa 6): retransmite para quem está em alcance — exatamente a mesma
  // relação usada pelo áudio, então salas isolam o chat do mesmo jeito.
  socket.on('chat', ({ text }) => {
    if (!chatBucket.tryConsume()) {
      rateLimited.chat++;
      return;
    }
    const clean = typeof text === 'string' ? text.trim().slice(0, MAX_CHAT_LENGTH) : '';
    if (clean.length === 0) return; // mensagem vazia: ignora

    const msg = { from: id, text: clean, at: Date.now() };
    for (const to of proximity.getNearPeers(id)) {
      io.to(to).emit('chat', msg);
    }
    socket.emit('chat', msg); // eco ao remetente, para ele ver a própria mensagem
  });

  socket.on('disconnect', () => {
    const p = players.get(id);
    // Guarda o estado para religar (item 7): a posição salva é a última já
    // validada pelo servidor — restaurá-la depois não confia no cliente.
    if (p && sessionId) {
      sessionStore.save(sessionId, { x: p.x, y: p.y, name: p.name, muted: p.muted });
    }
    players.delete(id);
    validators.delete(id);
    lastCorrectionAt.delete(id);
    // Notifica pares que estavam próximos (peer:leave) antes de sair.
    proximity.removePlayer(id, emitPeerLeave);
    io.emit('player:left', { id }); // remove da tela de todos os outros
    console.log(`[-] desconectou ${id} (${players.size} online)`);
  });
});

httpServer.listen(PORT, () => {
  const proto = secure ? 'https' : 'http';
  console.log(`Servidor Socket.io ouvindo em ${proto}://localhost:${PORT}`);
});
