/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONDUIT_BASE_URL?: string;
  readonly VITE_CONDUIT_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
