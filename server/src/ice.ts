// Configuração de servidores ICE (STUN/TURN) para o WebRTC (Fase 2, item 3).
//
// TURN auto-hospedado com coturn no modo `use-auth-secret` (REST API): o
// servidor gera credenciais EFÊMERAS por HMAC, então nenhuma senha de longa
// duração vai para o bundle do cliente. O coturn valida a mesma HMAC com o
// segredo compartilhado (`static-auth-secret` no turnserver.conf).
//
// Formato das credenciais (padrão coturn / RFC 5766 TURN REST API):
//   username   = "<expiry-unix-seconds>[:label]"
//   credential = base64( HMAC_SHA1( segredo, username ) )

import { createHmac } from 'node:crypto';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceOptions {
  stunUrls: string[];
  turnUrls: string[];
  /** Segredo compartilhado com o coturn (credenciais efêmeras). */
  turnSecret?: string;
  /** Validade das credenciais efêmeras, em segundos. */
  turnTtlSeconds: number;
  /** Alternativa a `turnSecret`: usuário/senha estáticos (menos seguro). */
  turnStaticUsername?: string;
  turnStaticCredential?: string;
  /** Rótulo opcional embutido no username efêmero (diagnóstico no coturn). */
  label?: string;
}

const DEFAULT_TTL = 12 * 60 * 60; // 12h

/** Divide uma lista separada por vírgulas em itens não vazios. */
function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Monta as opções de ICE a partir de variáveis de ambiente. */
export function iceOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): IceOptions {
  // Sem STUN configurado, cai num STUN público (gratuito) para funcionar de
  // imediato em dev. Em produção, aponte para o próprio coturn (ele também é
  // um servidor STUN) via STUN_URLS.
  const stunUrls = splitList(env.STUN_URLS);
  return {
    stunUrls: stunUrls.length > 0 ? stunUrls : ['stun:stun.l.google.com:19302'],
    turnUrls: splitList(env.TURN_URLS),
    turnSecret: env.TURN_SECRET || undefined,
    turnTtlSeconds: Number(env.TURN_TTL_SECONDS ?? DEFAULT_TTL),
    turnStaticUsername: env.TURN_USERNAME || undefined,
    turnStaticCredential: env.TURN_PASSWORD || undefined,
    label: env.TURN_LABEL || 'mygather',
  };
}

/** Gera as credenciais efêmeras do coturn para um dado instante. */
export function ephemeralTurnCredentials(
  secret: string,
  ttlSeconds: number,
  label: string | undefined,
  now: number
): { username: string; credential: string } {
  const expiry = Math.floor(now / 1000) + ttlSeconds;
  const username = label ? `${expiry}:${label}` : `${expiry}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

/**
 * Constrói a lista de iceServers (STUN + TURN, se configurado).
 * `now` é injetável para testes determinísticos.
 */
export function buildIceServers(opts: IceOptions, now: number = Date.now()): IceServer[] {
  const servers: IceServer[] = opts.stunUrls.map((urls) => ({ urls }));

  if (opts.turnUrls.length > 0) {
    if (opts.turnSecret) {
      const { username, credential } = ephemeralTurnCredentials(
        opts.turnSecret,
        opts.turnTtlSeconds,
        opts.label,
        now
      );
      servers.push({ urls: opts.turnUrls, username, credential });
    } else if (opts.turnStaticUsername && opts.turnStaticCredential) {
      servers.push({
        urls: opts.turnUrls,
        username: opts.turnStaticUsername,
        credential: opts.turnStaticCredential,
      });
    } else {
      // TURN configurado sem credencial: inútil e mascara erro de config.
      console.warn('[ice] TURN_URLS definido sem TURN_SECRET nem TURN_USERNAME/PASSWORD; ignorando TURN.');
    }
  }

  return servers;
}
