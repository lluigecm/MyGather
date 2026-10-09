/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL do servidor Socket.io (sobrescreve a derivada da origem da página). */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
