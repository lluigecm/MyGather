// Reconexão preservando identidade de sessão (Fase 2, item 7).
//
// Ao desconectar, guarda o último estado AUTORITATIVO do jogador (posição já
// validada, nome, mudo) sob um sessionId gerado pelo cliente. Ao reconectar
// dentro da janela de carência, restaura esse estado — o cliente NUNCA envia a
// posição, então isto não reabre o furo do item 1 (posição forjada).
//
// O sessionId serve APENAS para religar ao estado, não para autenticar (a auth
// é o token compartilhado, item 4). É um UUID aleatório do cliente, inadivinhável.

export interface SavedSession {
  x: number;
  y: number;
  name: string;
  muted: boolean;
}

/** Aceita apenas ids plausíveis de sessão (evita chaves absurdas/enormes). */
export function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

export class SessionStore {
  private readonly saved = new Map<string, { data: SavedSession; expiresAt: number }>();

  constructor(private readonly graceMs: number) {}

  /** Guarda (ou sobrescreve) o estado de uma sessão que acabou de cair. */
  save(sessionId: string, data: SavedSession, now: number = Date.now()): void {
    this.saved.set(sessionId, { data, expiresAt: now + this.graceMs });
  }

  /**
   * Restaura e REMOVE o estado (uso único), se ainda dentro da carência.
   * Retorna null se não existe ou já expirou.
   */
  take(sessionId: string, now: number = Date.now()): SavedSession | null {
    const entry = this.saved.get(sessionId);
    if (!entry) return null;
    this.saved.delete(sessionId);
    return entry.expiresAt > now ? entry.data : null;
  }

  /** Remove sessões expiradas (chamado periodicamente). */
  sweep(now: number = Date.now()): void {
    for (const [key, entry] of this.saved) {
      if (entry.expiresAt <= now) this.saved.delete(key);
    }
  }

  get size(): number {
    return this.saved.size;
  }
}
