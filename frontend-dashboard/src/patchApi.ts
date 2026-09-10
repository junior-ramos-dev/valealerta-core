import type { Polygon } from "geojson";
import type { AppRole, AppUser } from "./auth";
import { getSupabase, isDatabaseEnabled } from "./supabaseClient";
import type { TopoPatchFeature } from "./topoPatches";

type ReportRow = {
  id: string;
  region_id: string;
  user_id: string;
  name: string | null;
  delta_m: number;
  geojson: Polygon;
  form: Record<string, unknown> | null;
  created_at: string;
  validated_at: string | null;
  profiles?:
    | { display_name: string | null; role: AppRole | null }
    | { display_name: string | null; role: AppRole | null }[]
    | null;
};

function profileOf(row: ReportRow) {
  const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return p ?? null;
}

function rowToFeature(row: ReportRow): TopoPatchFeature | null {
  if (row.geojson?.type !== "Polygon") return null;
  const delta = Number(row.delta_m);
  if (!Number.isFinite(delta) || delta === 0) return null;
  const author =
    profileOf(row)?.display_name?.trim() || row.user_id.slice(0, 8);
  return {
    type: "Feature",
    id: row.id,
    properties: {
      id: row.id,
      delta_m: delta,
      name: row.name ?? undefined,
      source: "usuario",
      created_at: row.created_at,
      origin: "remote",
      created_by: author,
      created_by_id: row.user_id,
      validated_at: row.validated_at ?? undefined,
    },
    geometry: row.geojson,
  };
}

export async function fetchRemotePatches(
  regionId: string,
): Promise<TopoPatchFeature[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("topo_patch_reports")
    .select("id, region_id, user_id, name, delta_m, geojson, form, created_at, validated_at, profiles(display_name, role)")
    .eq("region_id", regionId);
  if (error || !data) {
    console.error(error);
    return [];
  }
  return (data as ReportRow[])
    .map(rowToFeature)
    .filter((f): f is TopoPatchFeature => f != null);
}

export async function upsertRemotePatch(
  feature: TopoPatchFeature,
  regionId: string,
  user: AppUser,
): Promise<void> {
  const sb = getSupabase();
  if (!sb || user.backend !== "supabase") return;
  const { error } = await sb.from("topo_patch_reports").upsert({
    id: feature.properties.id,
    region_id: regionId,
    user_id: user.id,
    name: feature.properties.name ?? null,
    delta_m: feature.properties.delta_m,
    geojson: feature.geometry,
    form: {
      name: feature.properties.name,
      delta_m: feature.properties.delta_m,
    },
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function deleteRemotePatch(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("topo_patch_reports").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function validateRemotePatch(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.rpc("validate_topo_patch", { report_id: id });
  if (error) throw new Error(error.message);
}

export async function listProfiles(): Promise<
  { id: string; display_name: string; role: AppRole }[]
> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("profiles")
    .select("id, display_name, role")
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id as string,
    display_name: (row.display_name as string | null)?.trim() || row.id.slice(0, 8),
    role: (row.role as AppRole) ?? "reporter",
  }));
}

export async function setRemoteProfileRole(
  id: string,
  role: AppRole,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.rpc("set_profile_role", {
    target: id,
    new_role: role,
  });
  if (error) throw new Error(error.message);
}

export { isDatabaseEnabled };
