// Gerenciamento de peers WebRTC (Etapa 4).
// Topologia mesh: uma conexão direta por peer em proximidade.
//
// Parte 1: signaling (offer/answer/ICE) via Socket.io até o estado "connected".
// Parte 2: envia o stream local de áudio e reproduz o stream de cada peer.

import SimplePeer from 'simple-peer';
import type { Instance as PeerInstance, SignalData } from 'simple-peer';

export type PeerStatus = 'connecting' | 'connected';

interface PeerEntry {
  peer: PeerInstance;
  status: PeerStatus;
  attempt: number; // tentativa atual (base do backoff)
  connectTimer: number; // timeout do handshake
}

const MAX_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 500; // backoff exponencial: 500, 1000, 2000, ...
// Handshake que não completa neste prazo é tratado como falha (senão o peer
// ficaria preso em "connecting" para sempre, sem nunca tentar de novo).
const CONNECT_TIMEOUT_MS = 8000;

export class PeerManager {
  private readonly entries = new Map<string, PeerEntry>();
  /** Peers em proximidade (define se ainda vale a pena tentar reconectar). */
  private readonly nearby = new Set<string>();
  /** Retentativas agendadas, para poder cancelá-las ao sair de alcance. */
  private readonly retryTimers = new Map<string, number>();
  /** Um <audio> por peer, reproduzindo o stream remoto. */
  private readonly audioElements = new Map<string, HTMLAudioElement>();
  private gestureResumeInstalled = false;

  // --- Detecção de fala (Etapa 7) ---
  // Um analisador por stream (local e de cada peer). O nível é medido
  // localmente, sem tráfego extra de rede.
  private audioContext: AudioContext | null = null;
  private readonly analysers = new Map<string, AnalyserNode>();
  private readonly speakingUntil = new Map<string, number>();
  private static readonly SELF_KEY = '@self';
  /** RMS normalizado (0..1) acima do qual consideramos que há fala. */
  private static readonly SPEAK_THRESHOLD = 0.045;
  /** Mantém o indicador aceso por um tempo após o pico, evitando piscar. */
  private static readonly SPEAK_HOLD_MS = 350;

  /** STUN/TURN usados nas conexões (fornecidos pelo servidor no welcome). */
  private iceServers: RTCIceServer[] = [];
  /** Modo de teste (?forceRelay=1): proíbe P2P direto → força uso do TURN. */
  private forceRelay = false;

  // --- Vídeo (Fase 2): stream/track de câmera local e vídeos remotos ---
  private localVideoStream: MediaStream | null = null;
  private localVideoTrack: MediaStreamTrack | null = null;
  /** Chamado quando chega/atualiza o vídeo de um peer (o dono monta o tile). */
  onRemoteVideo: (peerId: string, stream: MediaStream) => void = () => {};
  /** Chamado quando o vídeo de um peer some (câmera desligada ou saiu). */
  onRemoteVideoRemoved: (peerId: string) => void = () => {};
  /** Peers que estão nos enviando vídeo agora. */
  private readonly remoteVideoPeers = new Set<string>();

  constructor(
    private readonly sendSignal: (to: string, data: unknown) => void,
    private readonly getSelfId: () => string | null,
    private readonly onChange: () => void = () => {},
    /** Stream local de áudio; null se o microfone não estiver disponível. */
    private localStream: MediaStream | null = null
  ) {
    // O stream local pode vir já no construtor (fluxo normal do main.ts).
    if (this.localStream) this.attachAnalyser(PeerManager.SELF_KEY, this.localStream);
  }

  /**
   * Define os servidores ICE. Vale para peers criados a partir daqui; os já
   * conectados seguem com a config anterior (renegociar não vale a pena num
   * protótipo). Como o welcome chega antes de qualquer peer:enter, na prática
   * todos os peers nascem já com a config correta.
   */
  setIceServers(servers: RTCIceServer[]): void {
    this.iceServers = servers;
  }

  /** Liga o modo relay-only (diagnóstico de TURN). Vale para peers novos. */
  setForceRelay(on: boolean): void {
    this.forceRelay = on;
  }

  /**
   * Define o stream local. Peers criados a partir daí já o enviam; os que já
   * existem recebem as faixas via addStream.
   */
  setLocalStream(stream: MediaStream | null): void {
    this.localStream = stream;
    if (!stream) return;
    this.attachAnalyser(PeerManager.SELF_KEY, stream);
    for (const [peerId, entry] of this.entries) {
      try {
        entry.peer.addStream(stream);
      } catch (err) {
        console.warn(`[webrtc] não foi possível adicionar stream a ${peerId}:`, err);
      }
    }
  }

  get hasLocalStream(): boolean {
    return this.localStream !== null;
  }

  get hasVideo(): boolean {
    return this.localVideoTrack !== null;
  }

  /**
   * Liga a câmera: adiciona o track de vídeo a TODAS as conexões já existentes
   * (renegociação sobre a MESMA conexão — não cria peer novo). Peers que
   * surgirem depois recebem o vídeo no createPeer.
   */
  enableVideo(stream: MediaStream): void {
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    this.localVideoStream = stream;
    this.localVideoTrack = track;
    for (const [peerId, entry] of this.entries) {
      try {
        entry.peer.addTrack(track, stream);
      } catch (err) {
        console.warn(`[webrtc] falha ao enviar vídeo para ${peerId}:`, err);
      }
    }
  }

  /** Desliga a câmera: remove o track de todas as conexões e para a câmera. */
  disableVideo(): void {
    const track = this.localVideoTrack;
    const stream = this.localVideoStream;
    if (!track || !stream) return;
    for (const [peerId, entry] of this.entries) {
      try {
        entry.peer.removeTrack(track, stream);
      } catch (err) {
        // Peer pode ter caído no meio — best-effort.
        console.warn(`[webrtc] falha ao remover vídeo de ${peerId}:`, err);
      }
    }
    track.stop();
    this.localVideoStream = null;
    this.localVideoTrack = null;
  }

  /**
   * Habilita/desabilita a transmissão do áudio local (Fase 2, item 6).
   * `track.enabled = false` faz o navegador enviar silêncio em vez da voz —
   * a voz real deixa de ser transmitida, SEM renegociar (a conexão P2P
   * permanece de pé). Retorna true se havia track para alternar.
   */
  setLocalAudioEnabled(enabled: boolean): boolean {
    if (!this.localStream) return false;
    let changed = false;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = enabled;
      changed = true;
    }
    return changed;
  }

  /** Quantos peers estão com áudio remoto ativo. */
  get remoteAudioCount(): number {
    return this.audioElements.size;
  }

  /** Há áudio recebido que a política de autoplay impediu de tocar. */
  get hasBlockedAudio(): boolean {
    return [...this.audioElements.values()].some((el) => el.paused);
  }

  // --- Detecção de fala (Etapa 7) -----------------------------------------

  /** Cria/reaproveita o AudioContext usado pelos analisadores de volume. */
  private ensureAudioContext(): AudioContext | null {
    if (this.audioContext) return this.audioContext;
    try {
      this.audioContext = new AudioContext();
    } catch (err) {
      console.warn('[webrtc] AudioContext indisponível; sem indicador de fala:', err);
      return null;
    }
    return this.audioContext;
  }

  /** Liga um analisador de volume a um stream, sob uma chave (peerId ou @self). */
  private attachAnalyser(key: string, stream: MediaStream): void {
    if (stream.getAudioTracks().length === 0) return;
    const ctx = this.ensureAudioContext();
    if (!ctx) return;
    try {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      // Só o analisador — não conectamos ao destino (o <audio> já reproduz).
      ctx.createMediaStreamSource(stream).connect(analyser);
      this.analysers.set(key, analyser);
    } catch (err) {
      console.warn(`[webrtc] não foi possível analisar o áudio de ${key}:`, err);
    }
  }

  /**
   * Amostra todos os analisadores e atualiza quem está falando.
   * Deve ser chamado a cada frame (é barato: apenas leitura de buffers).
   */
  sampleSpeaking(): void {
    if (this.analysers.size === 0) return;
    // O contexto nasce suspenso sem gesto do usuário; retomar é inofensivo.
    if (this.audioContext?.state === 'suspended') void this.audioContext.resume();

    const now = performance.now();
    const buf = new Uint8Array(1024);
    for (const [key, analyser] of this.analysers) {
      const n = Math.min(analyser.fftSize, buf.length);
      analyser.getByteTimeDomainData(buf.subarray(0, n));
      // RMS do desvio em relação ao silêncio (128).
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      if (Math.sqrt(sum / n) >= PeerManager.SPEAK_THRESHOLD) {
        this.speakingUntil.set(key, now + PeerManager.SPEAK_HOLD_MS);
      }
    }
  }

  /** O usuário local está falando agora? */
  get isSelfSpeaking(): boolean {
    return (this.speakingUntil.get(PeerManager.SELF_KEY) ?? 0) > performance.now();
  }

  /** IDs dos peers que estão falando agora. */
  getSpeakingPeers(): Set<string> {
    const now = performance.now();
    const speaking = new Set<string>();
    for (const [key, until] of this.speakingUntil) {
      if (key !== PeerManager.SELF_KEY && until > now) speaking.add(key);
    }
    return speaking;
  }

  /**
   * Só um dos lados pode ser o iniciador, senão ambos geram offer (glare).
   * Critério determinístico e consistente nos dois lados: menor id inicia.
   */
  private isInitiator(peerId: string): boolean {
    const self = this.getSelfId();
    return self !== null && self < peerId;
  }

  /** peer:enter → inicia o handshake WebRTC com esse peer. */
  handlePeerEnter(peerId: string): void {
    this.nearby.add(peerId);
    this.ensurePeer(peerId, this.isInitiator(peerId));
  }

  /** peer:leave → encerra a conexão e cancela retentativas pendentes. */
  handlePeerLeave(peerId: string): void {
    this.nearby.delete(peerId);
    const timer = this.retryTimers.get(peerId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.retryTimers.delete(peerId);
    }
    if (this.dropPeer(peerId)) {
      console.log(`[webrtc] encerrado com ${peerId}`);
      this.onChange();
    }
  }

  /** Signaling recebido do servidor (offer/answer/ICE). */
  handleSignal(from: string, data: unknown): void {
    const sig = data as SignalData & { type?: string };
    const existing = this.entries.get(from);

    // Uma nova offer significa que o outro lado reiniciou o handshake (retry).
    // O peer local antigo já não serve — descarta e recria, senão os dois lados
    // ficariam dessincronizados e a reconexão nunca fecharia.
    if (sig?.type === 'offer' && existing && existing.status !== 'connected') {
      this.dropPeer(from);
    }

    // O sinal pode chegar antes do peer:enter local → cria como não-iniciador.
    const entry = this.ensurePeer(from, false);
    try {
      entry.peer.signal(sig);
    } catch (err) {
      console.warn(`[webrtc] sinal inválido de ${from}:`, err);
    }
  }

  private ensurePeer(peerId: string, initiator: boolean): PeerEntry {
    const existing = this.entries.get(peerId);
    if (existing) return existing;
    return this.createPeer(peerId, initiator, 1);
  }

  private createPeer(peerId: string, initiator: boolean, attempt: number): PeerEntry {
    // Envia o áudio local (se houver). Sem stream, o simple-peer ainda abre um
    // data channel, então a conexão se estabelece mesmo sem microfone.
    const rtcConfig: RTCConfiguration = {};
    if (this.iceServers.length > 0) rtcConfig.iceServers = this.iceServers;
    if (this.forceRelay) rtcConfig.iceTransportPolicy = 'relay';
    const peer = new SimplePeer({
      initiator,
      trickle: true,
      ...(Object.keys(rtcConfig).length > 0 ? { config: rtcConfig } : {}),
      ...(this.localStream ? { stream: this.localStream } : {}),
    });

    const connectTimer = window.setTimeout(() => {
      const current = this.entries.get(peerId);
      if (current?.peer !== peer || current.status === 'connected') return;
      console.warn(`[webrtc] timeout de handshake com ${peerId} (${CONNECT_TIMEOUT_MS}ms)`);
      this.failPeer(peerId, peer);
    }, CONNECT_TIMEOUT_MS);

    const entry: PeerEntry = { peer, status: 'connecting', attempt, connectTimer };
    this.entries.set(peerId, entry);

    peer.on('signal', (data: SignalData) => this.sendSignal(peerId, data));

    // Stream remoto chegou → reproduz o áudio desse peer. Ao ligar a câmera, o
    // simple-peer pode reemitir 'stream' com um stream SÓ de vídeo — ignoramos,
    // senão o <audio> perderia a faixa de áudio (o vídeo vai pelo 'track').
    peer.on('stream', (remoteStream: MediaStream) => {
      if (this.entries.get(peerId)?.peer !== peer) return; // entrada obsoleta
      if (remoteStream.getAudioTracks().length === 0) return;
      this.attachRemoteAudio(peerId, remoteStream);
    });

    // Cada track recebido: vídeo → tile remoto (áudio já vem pelo 'stream').
    peer.on('track', (track: MediaStreamTrack, stream: MediaStream) => {
      if (this.entries.get(peerId)?.peer !== peer) return;
      if (track.kind !== 'video') return;
      this.remoteVideoPeers.add(peerId);
      this.onRemoteVideo(peerId, stream);
      this.onChange();
      // Câmera do outro lado desligada → o track termina/emudece.
      const remove = (): void => this.removeRemoteVideo(peerId);
      track.addEventListener('ended', remove);
      track.addEventListener('mute', remove);
    });

    // Se a câmera local já está ligada, este novo peer também recebe o vídeo.
    if (this.localVideoTrack && this.localVideoStream) {
      try {
        peer.addTrack(this.localVideoTrack, this.localVideoStream);
      } catch (err) {
        console.warn(`[webrtc] falha ao enviar vídeo ao novo peer ${peerId}:`, err);
      }
    }

    peer.on('connect', () => {
      const current = this.entries.get(peerId);
      if (current?.peer !== peer) return; // entrada obsoleta
      window.clearTimeout(current.connectTimer);
      current.status = 'connected';
      console.log(`[webrtc] conectado a ${peerId}`);
      this.onChange();
    });

    // Falha não pode travar o cliente: loga, limpa e reagenda.
    peer.on('error', (err: Error) => {
      console.warn(`[webrtc] erro com ${peerId}: ${err.message}`);
      this.failPeer(peerId, peer);
    });
    peer.on('close', () => this.failPeer(peerId, peer));

    this.onChange();
    return entry;
  }

  /**
   * Remove a entrada e destrói o peer, SEM reagendar. Retorna true se removeu.
   * Deletar do mapa antes de destruir faz o handler 'close' virar no-op.
   */
  private dropPeer(peerId: string): boolean {
    const entry = this.entries.get(peerId);
    if (!entry) return false;
    this.entries.delete(peerId);
    window.clearTimeout(entry.connectTimer);
    this.detachRemoteAudio(peerId); // o stream do peer sai junto com a conexão
    this.removeRemoteVideo(peerId); // e o tile de vídeo também
    try {
      entry.peer.destroy();
    } catch {
      /* destroy é best-effort */
    }
    return true;
  }

  /** Cria (ou reaproveita) o <audio> que toca o stream de um peer. */
  private attachRemoteAudio(peerId: string, stream: MediaStream): void {
    let el = this.audioElements.get(peerId);
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      el.dataset.peerId = peerId;
      // Não exibe controles: é só o transporte de áudio.
      el.style.display = 'none';
      document.body.appendChild(el);
      this.audioElements.set(peerId, el);
    }
    el.srcObject = stream;
    this.attachAnalyser(peerId, stream); // para o indicador de "falando"
    console.log(`[webrtc] áudio recebido de ${peerId}`);

    // Quem não concedeu o microfone não ganha a isenção de autoplay do Chrome:
    // o play() é recusado até haver um gesto do usuário. Sem uma retomada, esse
    // usuário nunca ouviria ninguém — por isso o listener de gesto abaixo.
    void el.play().catch((err: unknown) => {
      console.warn(`[webrtc] autoplay do áudio de ${peerId} bloqueado:`, err);
      this.installGestureResume();
      this.onChange();
    });
    this.onChange();
  }

  /**
   * Instala (uma única vez) um listener que, no primeiro gesto do usuário,
   * tenta tocar novamente todo áudio que ficou bloqueado pelo autoplay.
   */
  private installGestureResume(): void {
    if (this.gestureResumeInstalled) return;
    this.gestureResumeInstalled = true;

    const resume = (): void => {
      let resumedAny = false;
      for (const [peerId, el] of this.audioElements) {
        if (!el.paused) continue;
        resumedAny = true;
        void el.play().then(
          () => console.log(`[webrtc] áudio de ${peerId} retomado após gesto do usuário`),
          (err: unknown) => console.warn(`[webrtc] retomada falhou para ${peerId}:`, err)
        );
      }
      if (resumedAny) window.setTimeout(() => this.onChange(), 100);
    };

    document.addEventListener('pointerdown', resume);
    document.addEventListener('keydown', resume);
  }

  /** Remove o tile de vídeo de um peer (câmera desligada ou peer saiu). */
  private removeRemoteVideo(peerId: string): void {
    if (!this.remoteVideoPeers.delete(peerId)) return;
    this.onRemoteVideoRemoved(peerId);
    this.onChange();
  }

  /** Remove o áudio de um peer (ao encerrar/cair a conexão). */
  private detachRemoteAudio(peerId: string): void {
    const el = this.audioElements.get(peerId);
    if (!el) return;
    el.srcObject = null;
    el.remove();
    this.audioElements.delete(peerId);
    this.analysers.delete(peerId);
    this.speakingUntil.delete(peerId);
    console.log(`[webrtc] áudio removido de ${peerId}`);
  }

  /** Trata queda/erro/timeout e reagenda com backoff exponencial. */
  private failPeer(peerId: string, peer: PeerInstance): void {
    const entry = this.entries.get(peerId);
    if (entry?.peer !== peer) return; // já substituída/encerrada
    const attempt = entry.attempt;

    this.dropPeer(peerId);
    this.onChange();

    if (!this.nearby.has(peerId) || attempt >= MAX_ATTEMPTS) {
      if (this.nearby.has(peerId)) {
        console.warn(`[webrtc] desistindo de ${peerId} após ${attempt} tentativas`);
      }
      return;
    }

    // Backoff exponencial: 500ms, 1s, 2s, ...
    const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
    console.warn(`[webrtc] retry de ${peerId} em ${delay}ms (tentativa ${attempt + 1})`);

    const timer = window.setTimeout(() => {
      this.retryTimers.delete(peerId);
      if (this.nearby.has(peerId) && !this.entries.has(peerId)) {
        this.createPeer(peerId, this.isInitiator(peerId), attempt + 1);
      }
    }, delay);
    this.retryTimers.set(peerId, timer);
  }

  /**
   * Encerra TODAS as conexões e cancela retentativas. Usado quando o socket
   * cai: na reconexão os ids mudam, então nada do estado anterior aproveita.
   */
  closeAll(): void {
    for (const timer of this.retryTimers.values()) window.clearTimeout(timer);
    this.retryTimers.clear();
    this.nearby.clear();
    for (const peerId of [...this.entries.keys()]) this.dropPeer(peerId);
    this.onChange();
  }

  /** Estado atual de cada peer, para exibição/diagnóstico. */
  getStates(): { id: string; status: PeerStatus }[] {
    return [...this.entries.entries()].map(([id, e]) => ({ id, status: e.status }));
  }

  get connectedCount(): number {
    return this.getStates().filter((s) => s.status === 'connected').length;
  }
}
