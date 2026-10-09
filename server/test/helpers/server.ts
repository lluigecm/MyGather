// Helper de teste: sobe o servidor real (src/index.ts) numa porta livre e o
// derruba ao final. Usa o entrypoint de verdade, então testa o que roda em prod.

import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Descobre uma porta TCP livre pedindo uma efêmera ao SO. */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

export interface TestServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export interface StartOptions {
  /** Variáveis extras (ICE/TURN, TLS_CERT/TLS_KEY, …). */
  env?: Record<string, string>;
  /** true se o servidor sobe em HTTPS (a URL vira https). */
  https?: boolean;
}

/**
 * Sobe o servidor via `node --import tsx src/index.ts` (mesmo processo, sem
 * shell → child.kill funciona em qualquer plataforma) e espera o /health.
 */
export async function startTestServer(opts: StartOptions = {}): Promise<TestServer> {
  const port = await getFreePort();
  const serverDir = fileURLToPath(new URL('../../', import.meta.url)); // .../server/

  const child: ChildProcess = spawn(
    process.execPath,
    ['--import', 'tsx', 'src/index.ts'],
    {
      cwd: serverDir,
      env: { ...process.env, PORT: String(port), ...opts.env },
      stdio: 'ignore',
    }
  );

  const url = `${opts.https ? 'https' : 'http'}://localhost:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      // Qualquer resposta HTTP (inclusive 401 com auth ligada) significa que o
      // servidor está ouvindo — fetch só lança quando a conexão é recusada.
      await fetch(`${url}/health`);
      ready = true;
      break;
    } catch {
      /* ainda subindo */
    }
    await sleep(100);
  }
  if (!ready) {
    child.kill('SIGKILL');
    throw new Error(`servidor de teste não respondeu em ${url} a tempo`);
  }

  return {
    url,
    port,
    close(): Promise<void> {
      return new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGKILL');
      });
    },
  };
}
