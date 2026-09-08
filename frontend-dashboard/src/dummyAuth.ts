/** Placeholder auth until Vale Alerta has a real login. */

export const DUMMY_USERNAME = "usuario";
export const DUMMY_PASSWORD = "123";

const SESSION_KEY = "valealerta-dummy-auth";

export function readDummySession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === DUMMY_USERNAME;
  } catch {
    return false;
  }
}

export function tryDummyLogin(username: string, password: string): boolean {
  const ok =
    username.trim() === DUMMY_USERNAME && password === DUMMY_PASSWORD;
  if (ok) {
    try {
      sessionStorage.setItem(SESSION_KEY, DUMMY_USERNAME);
    } catch {
      /* ignore quota / private mode */
    }
  }
  return ok;
}

export function dummyLogout(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
