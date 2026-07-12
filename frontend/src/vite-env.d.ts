/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PLATFORM_ENABLED?: string;
  readonly VITE_PLATFORM_API_URL?: string;
  readonly VITE_AMAP_KEY?: string;
  readonly VITE_MAP_DEFAULT_ZOOM?: string;
  readonly VITE_MAP_DEFAULT_CENTER?: string;
  readonly VITE_EMAILJS_SERVICE_ID?: string;
  readonly VITE_EMAILJS_TEMPLATE_ID?: string;
  readonly VITE_EMAILJS_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
