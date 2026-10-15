/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLOUDBASE_ENV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
