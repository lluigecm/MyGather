// Entrypoint da Etapa 1: carrega o mapa, cria avatar e câmera, trata o clique
// do mouse (movimento por pathfinding) e roda o game loop a ~60fps com rAF.

import rawMap from './map.json';
import { isSolidAt, type MapData } from './collision.js';
import { validateMap } from './mapschema.js';
import { Player } from './player.js';
import { findPath } from './pathfinding.js';
import { Camera, Renderer } from './canvas.js';
import { Network, type RemotePlayer } from './network.js';
import { PeerManager } from './webrtc.js';
import { ChatPanel } from './chat.js';
import { type CharacterSprite } from './spritesheet.js';
import { CHARACTERS, DEFAULT_CHARACTER, normalizeCharacter, loadAllCharacters } from './characters.js';

// Endereço do servidor Socket.io. Deriva da origem da página para funcionar
// fora de localhost (mesmo host, porta 3000, mesmo protocolo → http/https e
// ws/wss casam, evitando mixed content). Sobrescrevível via VITE_SERVER_URL.
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ?? `${location.protocol}//${location.hostname}:3000`;

// A validação do map.json vive em mapschema.ts (compartilhada com o editor).

// --- Input (clique do mouse + pathfinding) ---------------------------------

/**
 * Instala o handler de clique esquerdo: converte a posição do clique em
 * coordenada de tile, e — se o tile for navegável — calcula o caminho A* a
 * partir do tile atual do avatar e o define como novo trajeto.
 *
 * Regras (seção 5.1 da spec):
 * - clique em tile bloqueado (wall/object/fora do mapa): ignorado, sem erro;
 * - clique durante movimento: setPath substitui o caminho → cancela e recalcula;
 * - destino inalcançável: findPath retorna null → nada acontece.
 */
function setupClickToMove(
  canvas: HTMLCanvasElement,
  player: Player,
  camera: Camera,
  map: MapData
): void {
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    // Converte coordenada de CSS para pixels internos do canvas (caso escalado).
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const screenX = (e.clientX - rect.left) * scaleX;
    const screenY = (e.clientY - rect.top) * scaleY;

    // Tela → mundo → tile.
    const worldX = screenX + camera.x;
    const worldY = screenY + camera.y;
    const col = Math.floor(worldX / map.tileSize);
    const row = Math.floor(worldY / map.tileSize);

    if (isSolidAt(map, col, row)) return; // tile bloqueado/fora → ignora

    const start = player.getCurrentTile(map);
    const path = findPath(map, start, { col, row });
    if (path) player.setPath(path, map); // null (inalcançável) → não faz nada
  });
}

// --- Captura de mídia ------------------------------------------------------

/**
 * Pede acesso ao microfone. Retorna null (sem lançar) se a API não existir,
 * a permissão for negada ou não houver dispositivo — a app segue funcionando
 * e as conexões P2P continuam sendo estabelecidas, apenas sem áudio local.
 */
async function requestMicrophone(): Promise<MediaStream | null> {
  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn('[media] getUserMedia indisponível neste contexto.');
    return null;
  }
  try {
    // Só áudio no boot; a câmera é ligada sob demanda pelo botão.
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    console.warn('[media] microfone indisponível:', err);
    return null;
  }
}

/** Pede a câmera (só vídeo). Null se indisponível/negada — não lança. */
async function requestCamera(): Promise<MediaStream | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } catch (err) {
    console.warn('[media] câmera indisponível:', err);
    return null;
  }
}

// --- Identidade de sessão (Fase 2, item 7) ---------------------------------

const SESSION_STORAGE_KEY = 'mygather:session';

/**
 * Id de sessão do cliente: um valor aleatório persistido no localStorage. Serve
 * só para o servidor religar ao estado anterior numa reconexão — não autentica
 * (a auth é o token). Aleatório e inadivinhável.
 */
function loadSessionId(): string {
  try {
    const saved = localStorage.getItem(SESSION_STORAGE_KEY);
    if (saved && /^[A-Za-z0-9_-]{8,128}$/.test(saved)) return saved;
    const id = crypto.randomUUID().replace(/-/g, '');
    localStorage.setItem(SESSION_STORAGE_KEY, id);
    return id;
  } catch {
    // Sem localStorage: gera um id efêmero (sem persistência entre reloads).
    return crypto.randomUUID().replace(/-/g, '');
  }
}

// --- Token de acesso (Fase 2, item 4) --------------------------------------

const TOKEN_STORAGE_KEY = 'mygather:token';

/**
 * Token do link (`?token=…`), com fallback no localStorage para sobreviver a
 * reloads. Ao achar na URL, persiste e limpa a query (não deixa o token
 * exposto na barra de endereço / histórico). Retorna null se não houver.
 */
function loadAccessToken(): string | null {
  try {
    const url = new URL(location.href);
    const fromUrl = url.searchParams.get('token');
    if (fromUrl && fromUrl.trim()) {
      const token = fromUrl.trim();
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
      url.searchParams.delete('token');
      history.replaceState(null, '', url.toString());
      return token;
    }
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

// --- Nome do jogador (Etapa 7) ---------------------------------------------

const NAME_STORAGE_KEY = 'mygather:name';

/** Nome salvo localmente, ou um "Convidado-XXXX" gerado na primeira visita. */
function loadPlayerName(): string {
  try {
    const saved = localStorage.getItem(NAME_STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch {
    /* localStorage pode estar bloqueado; segue com o nome gerado */
  }
  return `Convidado-${Math.random().toString(16).slice(2, 6)}`;
}

function savePlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_STORAGE_KEY, name);
  } catch {
    /* sem persistência é aceitável */
  }
}

// --- Personagem (Etapa 8) --------------------------------------------------

const CHARACTER_STORAGE_KEY = 'mygather:character';

function loadCharacterId(): string {
  try {
    return normalizeCharacter(localStorage.getItem(CHARACTER_STORAGE_KEY));
  } catch {
    return DEFAULT_CHARACTER;
  }
}
function saveCharacterId(id: string): void {
  try {
    localStorage.setItem(CHARACTER_STORAGE_KEY, id);
  } catch {
    /* sem persistência é aceitável */
  }
}

// --- Bootstrap + Game loop -------------------------------------------------

const EMPTY_PEERS: ReadonlySet<string> = new Set();
const EMPTY_REMOTES: ReadonlyMap<string, RemotePlayer> = new Map();
const EMPTY_CHARACTERS: ReadonlyMap<string, CharacterSprite> = new Map();
/** Por quanto tempo o balão de chat fica acima do avatar. */
const BUBBLE_MS = 6000;

function main(): void {
  const map = validateMap(rawMap);

  const canvasEl = document.getElementById('game');
  if (!(canvasEl instanceof HTMLCanvasElement)) {
    throw new Error('Elemento <canvas id="game"> não encontrado.');
  }
  const canvas: HTMLCanvasElement = canvasEl;

  const player = Player.fromSpawn(map);
  const camera = new Camera(canvas.width, canvas.height);
  const renderer = new Renderer(canvas);
  // Canvas responsivo: o buffer de desenho acompanha o tamanho em tela (definido
  // pelo CSS), então a visão do mapa preenche a janela em vez de um retângulo
  // fixo. A câmera segue o novo tamanho de viewport.
  function fitCanvasToWindow(): void {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      camera.resize(w, h);
    }
  }
  fitCanvasToWindow();
  window.addEventListener('resize', fitCanvasToWindow);
  // Fundo prerenderizado do tilemap (mapa desenhado no editor externo → 32px/tile).
  const mapBg = new Image();
  mapBg.onload = () => renderer.setBackground(mapBg);
  mapBg.src = new URL('./assets/map-render.png', import.meta.url).href;
  // A rede sobe de forma assíncrona (depois do microfone). Até lá o jogo já
  // roda normalmente — mapa, movimento e câmera não dependem de rede.
  let network: Network | null = null;
  let peerManager: PeerManager | null = null;

  // Personagem (Etapa 8): id escolhido + sprites carregados (async).
  let selfCharacter = loadCharacterId();
  let characterSprites: ReadonlyMap<string, CharacterSprite> = EMPTY_CHARACTERS;

  const statusEl = document.getElementById('webrtc-status');
  function renderStatus(): void {
    if (!statusEl) return;
    if (!peerManager) {
      statusEl.textContent = 'WebRTC: conectando…';
      return;
    }
    const mic = peerManager.hasLocalStream ? 'mic ativo' : 'sem mic';
    const states = peerManager.getStates();
    const peers =
      states.length === 0
        ? 'nenhum peer em alcance'
        : states.map((s) => `${s.id.slice(0, 6)}=${s.status}`).join(', ');
    const blocked = peerManager.hasBlockedAudio ? ' — clique na página para ouvir' : '';
    statusEl.textContent =
      `WebRTC (${mic}, áudio de ${peerManager.remoteAudioCount}): ${peers}${blocked}`;
  }
  renderStatus();

  // Chat (Etapa 6). O input só é liberado quando a rede estiver de pé.
  const chatLog = document.getElementById('chat-log');
  const chatInput = document.getElementById('chat-input');
  const chat =
    chatLog && chatInput instanceof HTMLInputElement
      ? new ChatPanel(chatLog, chatInput, (text) => network?.sendChat(text))
      : null;

  // --- Nome do jogador (Etapa 7) ---
  let playerName = loadPlayerName();
  const nameInput = document.getElementById('name-input');
  if (nameInput instanceof HTMLInputElement) {
    nameInput.value = playerName;
    const commit = (): void => {
      const value = nameInput.value.trim();
      if (value.length === 0) {
        nameInput.value = playerName; // não aceita nome vazio
        return;
      }
      if (value === playerName) return;
      playerName = value;
      savePlayerName(playerName);
      network?.setName(playerName);
    };
    nameInput.addEventListener('blur', commit);
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') nameInput.blur();
    });
  }

  // --- Balões de chat acima do avatar (Etapa 7) ---
  const bubbles = new Map<string, string>();
  const bubbleTimers = new Map<string, number>();
  function showBubble(playerId: string, text: string): void {
    bubbles.set(playerId, text);
    const previous = bubbleTimers.get(playerId);
    if (previous !== undefined) window.clearTimeout(previous);
    bubbleTimers.set(
      playerId,
      window.setTimeout(() => {
        bubbles.delete(playerId);
        bubbleTimers.delete(playerId);
      }, BUBBLE_MS)
    );
  }

  // --- Microfone: mudo / push-to-talk (Fase 2, item 6) ---
  let muted = false; // toggle do usuário
  let pttHeld = false; // barra de espaço mantida pressionada
  let selfEffectiveMuted = true; // o que os outros veem (mudo até haver mic)
  let lastSentMuted: boolean | null = null;
  const micButton = document.getElementById('mic-button');

  /** Aplica o estado do microfone: liga/desliga o track, avisa peers e UI. */
  function applyMicState(force = false): void {
    const hasMic = peerManager?.hasLocalStream ?? false;
    // Transmite se tem mic E (não está mudo OU está segurando pra falar).
    const transmitting = hasMic && (!muted || pttHeld);
    const effMuted = !transmitting;

    // "Parar de transmitir de fato": desliga o track de áudio (envia silêncio),
    // sem renegociar — a conexão P2P continua de pé.
    peerManager?.setLocalAudioEnabled(transmitting);
    selfEffectiveMuted = effMuted;

    // Só avisa o servidor quando muda (ou quando forçado, ex.: reconexão).
    if (force || effMuted !== lastSentMuted) {
      network?.setMuted(effMuted);
      lastSentMuted = effMuted;
    }

    if (micButton instanceof HTMLButtonElement) {
      const talking = muted && pttHeld && hasMic;
      micButton.disabled = !hasMic;
      micButton.classList.toggle('muted', hasMic && effMuted);
      micButton.classList.toggle('talking', talking);
      micButton.textContent = !hasMic
        ? '🚫 Sem microfone'
        : talking
          ? '🔵 Falando (espaço)'
          : muted
            ? '🔇 Mudo (M)'
            : '🎙️ Microfone ativo';
    }
  }

  function toggleMute(): void {
    if (!peerManager?.hasLocalStream) return;
    muted = !muted;
    applyMicState();
  }

  micButton?.addEventListener('click', toggleMute);

  const isTyping = (e: Event): boolean => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  };
  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      toggleMute();
    } else if (e.code === 'Space') {
      e.preventDefault(); // evita rolar a página / acionar o botão focado
      if (!pttHeld) {
        pttHeld = true;
        applyMicState();
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (pttHeld) {
        pttHeld = false;
        applyMicState();
      }
    }
  });

  // --- Vídeo: toggle de câmera + barra de tiles (Fase 2) ---
  const videoBar = document.getElementById('video-bar');
  const videoTiles = new Map<string, HTMLElement>();

  function upsertVideoTile(key: string, stream: MediaStream, label: string): void {
    let tile = videoTiles.get(key);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'video-tile';
      const v = document.createElement('video');
      v.autoplay = true;
      v.playsInline = true;
      v.muted = true; // tiles são só vídeo; o áudio vai pelos <audio> separados
      const l = document.createElement('div');
      l.className = 'label';
      tile.append(v, l);
      videoBar?.appendChild(tile);
      videoTiles.set(key, tile);
    }
    const video = tile.querySelector('video') as HTMLVideoElement;
    video.srcObject = stream;
    void video.play().catch(() => {});
    (tile.querySelector('.label') as HTMLElement).textContent = label;
  }
  function removeVideoTile(key: string): void {
    const tile = videoTiles.get(key);
    if (!tile) return;
    const v = tile.querySelector('video') as HTMLVideoElement | null;
    if (v) v.srcObject = null;
    tile.remove();
    videoTiles.delete(key);
  }

  let cameraOn = false;
  const cameraButton = document.getElementById('camera-button');
  function updateCameraButton(denied = false): void {
    if (!(cameraButton instanceof HTMLButtonElement)) return;
    cameraButton.disabled = !peerManager;
    cameraButton.classList.toggle('on', cameraOn);
    cameraButton.textContent = denied
      ? '🚫 Sem câmera'
      : cameraOn
        ? '📷 Câmera ligada'
        : '📷 Câmera';
  }
  async function toggleCamera(): Promise<void> {
    if (!peerManager) return;
    if (!cameraOn) {
      const stream = await requestCamera();
      if (!stream) {
        updateCameraButton(true);
        return;
      }
      peerManager.enableVideo(stream); // reusa as conexões WebRTC já abertas
      upsertVideoTile('@self', stream, 'você');
      cameraOn = true;
    } else {
      peerManager.disableVideo();
      removeVideoTile('@self');
      cameraOn = false;
    }
    updateCameraButton();
  }
  cameraButton?.addEventListener('click', () => void toggleCamera());

  // --- Seleção de personagem (Etapa 8) ---
  const charButton = document.getElementById('character-button');
  const charOverlay = document.getElementById('char-overlay');
  const charGrid = document.getElementById('char-grid');

  function highlightCharacter(): void {
    charGrid?.querySelectorAll('.char-option').forEach((el) => {
      el.classList.toggle('selected', (el as HTMLElement).dataset.char === selfCharacter);
    });
  }
  function applyCharacter(id: string): void {
    selfCharacter = normalizeCharacter(id);
    saveCharacterId(selfCharacter);
    network?.setCharacter(selfCharacter); // sincroniza com os outros
    highlightCharacter();
  }
  const closeCharOverlay = (): void => charOverlay?.classList.remove('open');
  function buildCharacterGrid(sprites: ReadonlyMap<string, CharacterSprite>): void {
    if (!charGrid) return;
    charGrid.textContent = '';
    for (const opt of CHARACTERS) {
      const cell = document.createElement('button');
      cell.className = 'char-option';
      cell.dataset.char = opt.id;
      const cvs = document.createElement('canvas');
      cvs.width = 64;
      cvs.height = 64;
      const cctx = cvs.getContext('2d');
      const sp = sprites.get(opt.id);
      if (cctx && sp) {
        cctx.imageSmoothingEnabled = false;
        const f = sp.idle('south');
        cctx.drawImage(sp.image, f.sx, f.sy, f.sw, f.sh, 0, 0, 64, 64);
      }
      const lbl = document.createElement('div');
      lbl.className = 'char-label';
      lbl.textContent = opt.label;
      cell.append(cvs, lbl);
      cell.addEventListener('click', () => {
        applyCharacter(opt.id);
        closeCharOverlay();
      });
      charGrid.appendChild(cell);
    }
    highlightCharacter();
  }
  charButton?.addEventListener('click', () => charOverlay?.classList.add('open'));
  document.getElementById('char-close')?.addEventListener('click', closeCharOverlay);

  void loadAllCharacters().then((sprites) => {
    characterSprites = sprites;
    buildCharacterGrid(sprites);
    if (charButton instanceof HTMLButtonElement) charButton.disabled = false;
    // Primeira visita (sem escolha salva): mostra a seleção antes de "entrar".
    let hasSaved = false;
    try {
      hasSaved = !!localStorage.getItem(CHARACTER_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    if (!hasSaved) charOverlay?.classList.add('open');
  });

  async function startNetworking(): Promise<void> {
    // Pede o microfone ANTES de conectar, para que os peers já nasçam com o
    // stream local anexado (evita renegociação no meio do handshake).
    const localStream = await requestMicrophone();

    // O PeerManager precisa da rede para signaling e a rede repassa os eventos
    // de peer para ele — daí a referência ser atribuída logo após a construção.
    let manager!: PeerManager;
    const net = new Network(
      SERVER_URL,
      playerName,
      selfCharacter,
      loadAccessToken(),
      loadSessionId(),
      {
        // O servidor é autoritativo: alinha o avatar e cancela o trajeto atual,
        // senão o pathfinding continuaria puxando de volta para o destino.
        onAuthoritativePosition: ({ x, y }) => {
          player.x = x;
          player.y = y;
          player.clearPath();
        },
        onIceServers: (servers) => manager.setIceServers(servers),
        onPeerEnter: (id) => manager.handlePeerEnter(id),
        onPeerLeave: (id) => manager.handlePeerLeave(id),
        onSignal: (from, data) => manager.handleSignal(from, data),
        onChat: (msg) => {
          const author =
            msg.from === net.id ? playerName : (net.remotePlayers.get(msg.from)?.name ?? null);
          chat?.addMessage(msg, net.id, author);
          showBubble(msg.from, msg.text);
        },
        // Reconexão automática (Etapa 7): na queda, todo o estado remoto e os
        // peers WebRTC são descartados — os ids não sobrevivem à reconexão.
        onDisconnected: (reason) => {
          manager.closeAll();
          bubbles.clear();
          chat?.setEnabled(false, 'Reconectando…');
          chat?.addSystemMessage(`Conexão perdida (${reason}). Reconectando…`);
          renderStatus();
        },
        onReconnected: () => {
          chat?.setEnabled(true, 'Mensagem (Enter para enviar)');
          chat?.addSystemMessage('Reconectado.');
          applyMicState(true); // reenvia o estado de mudo ao novo socket
          renderStatus();
        },
        onAuthError: () => {
          chat?.setEnabled(false, 'Acesso negado');
          chat?.addSystemMessage(
            'Acesso negado: link inválido ou expirado. Peça um novo link de acesso.'
          );
          if (statusEl) statusEl.textContent = 'WebRTC: acesso negado (token inválido)';
        },
      }
    );
    manager = new PeerManager(
      (to, data) => net.sendSignal(to, data),
      () => net.id,
      renderStatus,
      localStream
    );
    // Modo de diagnóstico de TURN: ?forceRelay=1 proíbe o P2P direto.
    if (new URLSearchParams(location.search).get('forceRelay') === '1') {
      manager.setForceRelay(true);
    }

    // Vídeo remoto: cria/remove um tile por peer que liga a câmera.
    manager.onRemoteVideo = (peerId, stream) => {
      const name = net.remotePlayers.get(peerId)?.name ?? peerId.slice(0, 6);
      upsertVideoTile(peerId, stream, name);
    };
    manager.onRemoteVideoRemoved = (peerId) => removeVideoTile(peerId);

    network = net;
    peerManager = manager;
    renderStatus();
    applyMicState(true); // aplica o track e informa o estado inicial do mic
    updateCameraButton(); // habilita o botão de câmera

    chat?.setEnabled(true, 'Mensagem (Enter para enviar)');
    chat?.addSystemMessage('Conectado. Mensagens só chegam a quem está por perto ou na mesma sala.');
  }

  void startNetworking();

  setupClickToMove(canvas, player, camera, map);

  let lastTime = performance.now();
  const MAX_DT = 1 / 30; // trava o dt (evita "salto" após aba inativa)

  function frame(now: number): void {
    // deltaTime em segundos → movimento independente da taxa de quadros.
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > MAX_DT) dt = MAX_DT;

    player.update(dt, map);
    camera.follow(player.x + player.width / 2, player.y + player.height / 2, map);

    // Envia a própria posição (throttle interno ~20x/s) e renderiza todos.
    // A rede pode ainda não estar pronta — o jogo roda igual.
    network?.sendPosition(player.x, player.y);
    peerManager?.sampleSpeaking();

    renderer.render({
      map,
      camera,
      player,
      playerName,
      playerSpeaking: peerManager?.isSelfSpeaking ?? false,
      selfMuted: selfEffectiveMuted,
      selfCharacter,
      characters: characterSprites,
      selfId: network?.id ?? null,
      remotePlayers: network?.remotePlayers ?? EMPTY_REMOTES,
      nearbyPeers: network?.nearbyPeers ?? EMPTY_PEERS,
      speakingPeers: peerManager?.getSpeakingPeers() ?? EMPTY_PEERS,
      bubbles,
    });

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main();
