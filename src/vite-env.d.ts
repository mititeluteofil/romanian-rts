/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the deployed site/relay for builds not served from it (Android). */
  readonly VITE_RELAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
