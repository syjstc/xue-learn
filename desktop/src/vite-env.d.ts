/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_ENABLE_DEV_TOOLS?: string;
  readonly VITE_ENABLE_CLASSROOM_STUDIO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
