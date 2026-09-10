/** Placeholder auth until Vale Alerta has a real login. */

export const DUMMY_PASSWORD = "123";

const SESSION_KEY = "valealerta-dummy-auth";

export function readDummyUsername(): string | null {
  try {
    const name = sessionStorage.getItem(SESSION_KEY);
    return name && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

export function readDummySession(): boolean {
  return readDummyUsername() != null;
}

/** Qualquer nome + senha 123, para simular vários relatores neste aparelho. */
export function tryDummyLogin(username: string, password: string): string | null {
  const name = username.trim();
  if (name.length < 2 || password !== DUMMY_PASSWORD) return null;
  try {
    sessionStorage.setItem(SESSION_KEY, name);
  } catch {
    /* ignore quota / private mode */
  }
  return name;
}

export type DummyPlacePrefs = {
  municipality?: string;
  preferredRegionId?: string;
  preferredCityId?: string;
};

const PREFS_KEY = "valealerta-dummy-profile";

export function readDummyPlacePrefs(): DummyPlacePrefs | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DummyPlacePrefs;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDummyPlacePrefs(prefs: DummyPlacePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}

export function dummyLogout(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
