/** Origem pública do PWA (e-mail de confirmação, links). Vite: `.env.development` vs `.env.production`. */

export type AppEnv = "development" | "production";

export function appEnv(): AppEnv {
  const flag = String(import.meta.env.VITE_APP_ENV ?? "").trim().toLowerCase();
  if (flag === "production") return "production";
  if (flag === "development") return "development";
  return import.meta.env.PROD ? "production" : "development";
}

export function isProduction(): boolean {
  return appEnv() === "production";
}

/** Sem barra no final. */
export function publicAppUrl(): string {
  const fromEnv = String(import.meta.env.VITE_APP_URL ?? "").trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return isProduction()
    ? "https://valealertasc.com.br"
    : "http://localhost:5173";
}

export function emailRedirectTo(): string {
  return `${publicAppUrl()}/`;
}
