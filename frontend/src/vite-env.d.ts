/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PLATFORM_ENABLED?: string;
  readonly VITE_PLATFORM_API_URL?: string;
  readonly VITE_AMAP_KEY?: string;
  readonly VITE_MAP_DEFAULT_ZOOM?: string;
  readonly VITE_MAP_DEFAULT_CENTER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
