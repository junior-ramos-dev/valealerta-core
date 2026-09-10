import { dummyLogout, readDummyUsername, tryDummyLogin } from "./dummyAuth";
import { getSupabase, isDatabaseEnabled } from "./supabaseClient";

export type AppRole = "reporter" | "validator" | "admin";

export type AppUser = {
  id: string;
  name: string;
  role: AppRole;
  backend: "supabase" | "dummy";
};

function asRole(raw: unknown): AppRole {
  if (raw === "validator" || raw === "admin" || raw === "reporter") return raw;
  return "reporter";
}

async function profileFromSession(
  userId: string,
  fallbackName: string,
): Promise<AppUser> {
  const sb = getSupabase();
  if (!sb) {
    return { id: userId, name: fallbackName, role: "reporter", backend: "dummy" };
  }
  const { data } = await sb
    .from("profiles")
    .select("display_name, role")
    .eq("id", userId)
    .maybeSingle();
  return {
    id: userId,
    name: (data?.display_name as string | undefined)?.trim() || fallbackName,
    role: asRole(data?.role),
    backend: "supabase",
  };
}

export async function restoreAppUser(): Promise<AppUser | null> {
  const sb = getSupabase();
  if (sb) {
    const { data } = await sb.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    return profileFromSession(
      user.id,
      user.email?.split("@")[0] ?? "relator",
    );
  }
  const name = readDummyUsername();
  if (!name) return null;
  return { id: `dummy:${name}`, name, role: "reporter", backend: "dummy" };
}

export async function loginAppUser(
  identifier: string,
  password: string,
): Promise<AppUser> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.auth.signInWithPassword({
      email: identifier.trim(),
      password,
    });
    if (error || !data.user) {
      throw new Error(error?.message ?? "Não foi possível entrar.");
    }
    return profileFromSession(
      data.user.id,
      data.user.email?.split("@")[0] ?? identifier.trim(),
    );
  }
  const name = tryDummyLogin(identifier, password);
  if (!name) {
    throw new Error("Use um nome (2+ letras) e a senha provisória 123.");
  }
  return { id: `dummy:${name}`, name, role: "reporter", backend: "dummy" };
}

export async function signUpAppUser(
  email: string,
  password: string,
  displayName: string,
): Promise<AppUser> {
  const sb = getSupabase();
  if (!sb) {
    throw new Error("Banco não configurado (VITE_SUPABASE_URL).");
  }
  const { data, error } = await sb.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { display_name: displayName.trim() } },
  });
  if (error || !data.user) {
    throw new Error(error?.message ?? "Não foi possível criar a conta.");
  }
  if (data.session) {
    return profileFromSession(
      data.user.id,
      displayName.trim() || email.split("@")[0],
    );
  }
  throw new Error(
    "Conta criada. Confirme o e-mail se o projeto exigir, depois entre.",
  );
}

export async function logoutAppUser(): Promise<void> {
  const sb = getSupabase();
  if (sb) await sb.auth.signOut();
  dummyLogout();
}

export { isDatabaseEnabled };
