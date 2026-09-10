import { dummyLogout, readDummyPlacePrefs, readDummyUsername, saveDummyPlacePrefs, tryDummyLogin } from "./dummyAuth";
import { storeCityId, storeRegionId } from "./region";
import { getSupabase, isDatabaseEnabled } from "./supabaseClient";

export type AppRole = "reporter" | "validator" | "admin";

export type AppUser = {
  id: string;
  name: string;
  role: AppRole;
  backend: "supabase" | "dummy";
  municipality?: string;
  preferredRegionId?: string;
  preferredCityId?: string;
};

export type SignupProfile = {
  displayName: string;
  homeCity: string;
  homeState: string;
  preferredRegionId: string;
  preferredCityId: string;
};

export function municipalityLabel(city: string, uf: string): string {
  return `${city.trim()} / ${uf.trim()}`;
}

function asRole(raw: unknown): AppRole {
  if (raw === "validator" || raw === "admin" || raw === "reporter") return raw;
  return "reporter";
}

function optionalText(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  return t || undefined;
}

function dummyUser(name: string): AppUser {
  const prefs = readDummyPlacePrefs();
  return {
    id: `dummy:${name}`,
    name,
    role: "reporter",
    backend: "dummy",
    municipality: prefs?.municipality,
    preferredRegionId: prefs?.preferredRegionId,
    preferredCityId: prefs?.preferredCityId,
  };
}

async function profileFromSession(
  userId: string,
  fallbackName: string,
): Promise<AppUser> {
  const sb = getSupabase();
  if (!sb) {
    return dummyUser(fallbackName);
  }
  const { data } = await sb
    .from("profiles")
    .select(
      "display_name, role, municipality, preferred_region_id, preferred_city_id",
    )
    .eq("id", userId)
    .maybeSingle();
  return {
    id: userId,
    name: optionalText(data?.display_name) || fallbackName,
    role: asRole(data?.role),
    backend: "supabase",
    municipality: optionalText(data?.municipality),
    preferredRegionId: optionalText(data?.preferred_region_id),
    preferredCityId: optionalText(data?.preferred_city_id),
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
  return dummyUser(name);
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
  return dummyUser(name);
}

export async function signUpAppUser(
  email: string,
  password: string,
  profile: SignupProfile,
): Promise<AppUser> {
  const displayName = profile.displayName.trim() || email.trim();
  const municipality = municipalityLabel(profile.homeCity, profile.homeState);
  const meta = {
    display_name: displayName,
    municipality,
    preferred_region_id: profile.preferredRegionId,
    preferred_city_id: profile.preferredCityId,
  };
  storeRegionId(profile.preferredRegionId);
  storeCityId(profile.preferredRegionId, profile.preferredCityId);

  const sb = getSupabase();
  if (!sb) {
    const name = tryDummyLogin(email, password);
    if (!name) {
      throw new Error("Use um nome (2+ letras) e a senha provisória 123.");
    }
    saveDummyPlacePrefs({
      municipality,
      preferredRegionId: profile.preferredRegionId,
      preferredCityId: profile.preferredCityId,
    });
    return dummyUser(name);
  }

  const { data, error } = await sb.auth.signUp({
    email: email.trim(),
    password,
    options: { data: meta },
  });
  if (error || !data.user) {
    throw new Error(error?.message ?? "Não foi possível criar a conta.");
  }

  if (data.session) {
    await sb
      .from("profiles")
      .update({
        display_name: displayName,
        municipality,
        preferred_region_id: profile.preferredRegionId,
        preferred_city_id: profile.preferredCityId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.user.id);
    return profileFromSession(data.user.id, displayName);
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
