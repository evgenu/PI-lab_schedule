import { existsSync } from 'node:fs';

export interface Config {
  port: number;
  baseUrl: string;
  databaseUrl: string | null;
  google: { clientId: string; clientSecret: string } | null;
  gemini: { apiKey: string; model: string } | null;
  modelTimeoutMs: number;
  /** Secure cookies need HTTPS, so they are on whenever the public URL is https. */
  secureCookies: boolean;
}

/** Reads every setting from the environment. Secrets never come from a file in the repository. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, '');
  const timeout = Number(env.MODEL_TIMEOUT_MS);
  return {
    port: Number(env.PORT) || 3000,
    baseUrl,
    databaseUrl: env.DATABASE_URL || null,
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : null,
    gemini: env.GEMINI_API_KEY
      ? { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-2.5-flash' }
      : null,
    modelTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 8_000,
    secureCookies: baseUrl.startsWith('https://'),
  };
}

/** Loads a local, git-ignored .env file if one exists. Hosts set real variables instead. */
export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
