export interface Env {
  DB: D1Database;
  RELAY: DurableObjectNamespace;
  NEBIUS_BASE_URL: string;
  TAVILY_KEY_CAP: string;
  BOOTSTRAP_USERNAME: string;
  BOOTSTRAP_PASSWORD?: string;
  JWT_SECRET: string;
  NEBIUS_API_KEY?: string;
  TAVILY_API_KEY?: string;
}

export const nowSec = () => Math.floor(Date.now() / 1000);
