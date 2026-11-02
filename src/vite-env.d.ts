/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public URL of the Supabase Edge Function contact-submit. Not a secret. */
  readonly VITE_CONTACT_FUNCTION_URL?: string;
  readonly VITE_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
