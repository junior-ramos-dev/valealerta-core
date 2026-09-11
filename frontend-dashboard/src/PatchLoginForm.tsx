import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import {
  isDatabaseEnabled,
  loginAppUser,
  signUpAppUser,
  type AppUser,
} from "./auth";
import {
  loadRegionPack,
  type RegionCatalog,
  type RegionCity,
} from "./region";

const BR_UFS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

const fieldStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "#2d2d2d",
  color: "#fff",
  border: "1px solid #444",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 12,
};

export function PatchLoginForm({
  catalog,
  currentRegionId,
  currentCityId,
  onLoggedIn,
}: {
  catalog: RegionCatalog | null;
  currentRegionId?: string;
  currentCityId?: string;
  onLoggedIn: (user: AppUser) => void;
}) {
  const db = isDatabaseEnabled();
  const defaultRegion =
    currentRegionId || catalog?.default_region || catalog?.regions[0]?.id || "";
  const [mode, setMode] = useState<"in" | "up">("in");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [homeCity, setHomeCity] = useState("");
  const [homeState, setHomeState] = useState("SC");
  const [preferredRegionId, setPreferredRegionId] = useState(defaultRegion);
  const [preferredCityId, setPreferredCityId] = useState(currentCityId ?? "");
  const [cities, setCities] = useState<RegionCity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (currentRegionId) setPreferredRegionId(currentRegionId);
  }, [currentRegionId]);

  useEffect(() => {
    if (currentCityId) setPreferredCityId(currentCityId);
  }, [currentCityId]);

  useEffect(() => {
    if (!preferredRegionId) {
      setCities([]);
      return;
    }
    let cancelled = false;
    void loadRegionPack(preferredRegionId)
      .then((pack) => {
        if (cancelled) return;
        setCities(pack.cities);
        setPreferredCityId((prev) =>
          pack.cities.some((c) => c.id === prev)
            ? prev
            : currentCityId && pack.cities.some((c) => c.id === currentCityId)
              ? currentCityId
              : pack.target_city_id,
        );
      })
      .catch(() => {
        if (!cancelled) setCities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [preferredRegionId, currentCityId]);

  const finish = async (next: "in" | "up") => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (next === "up") {
        const name = displayName.trim() || identifier.trim();
        if (name.length < 2) {
          throw new Error("Informe o nome para o cadastro.");
        }
        if (homeCity.trim().length < 2) {
          throw new Error("Informe a cidade onde você reside.");
        }
        if (!preferredRegionId || !preferredCityId) {
          throw new Error("Escolha a bacia e a cidade padrão do aplicativo.");
        }
        const result = await signUpAppUser(identifier, password, {
          displayName: name,
          homeCity,
          homeState,
          preferredRegionId,
          preferredCityId,
        });
        if (result.status === "confirm-email") {
          setMode("in");
          setNotice(
            "Conta criada. Abra o e-mail do Vale Alerta SC, confirme o cadastro e depois entre aqui com o mesmo e-mail e senha.",
          );
          return;
        }
        onLoggedIn(result.user);
        return;
      }
      onLoggedIn(await loginAppUser(identifier, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login.");
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void finish(mode);
  };

  return (
    <form
      onSubmit={submit}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div className="patch-auth-modes" role="tablist" aria-label="Entrar ou cadastrar">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "in"}
          className={mode === "in" ? "is-on" : ""}
          onClick={() => setMode("in")}
        >
          Entrar
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "up"}
          className={mode === "up" ? "is-on" : ""}
          onClick={() => setMode("up")}
        >
          Cadastrar
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: "#888", lineHeight: 1.4 }}>
        {db
          ? mode === "up"
            ? "Crie a conta para enviar correções de relevo. Vamos enviar um e-mail do Vale Alerta SC para confirmar o cadastro. A bacia e a cidade padrão abrem o mapa da próxima vez."
            : "Entre com e-mail e senha. As demarcações gravam no banco na hora."
          : "Banco não configurado (VITE_SUPABASE_URL). Neste aparelho: nome + senha 123."}
      </p>
      {mode === "up" && (
        <>
          <label style={{ fontSize: 11, color: "#aaa" }}>
            Nome
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              style={{ ...fieldStyle, marginTop: 4 }}
              autoComplete="name"
            />
          </label>
          <label style={{ fontSize: 11, color: "#aaa" }}>
            Cidade onde reside
            <input
              type="text"
              value={homeCity}
              onChange={(e) => setHomeCity(e.target.value)}
              style={{ ...fieldStyle, marginTop: 4 }}
              autoComplete="address-level2"
            />
          </label>
          <label style={{ fontSize: 11, color: "#aaa" }}>
            Estado
            <select
              value={homeState}
              onChange={(e) => setHomeState(e.target.value)}
              style={{ ...fieldStyle, marginTop: 4 }}
            >
              {BR_UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 11, color: "#aaa" }}>
            Bacia padrão ao abrir
            <select
              value={preferredRegionId}
              onChange={(e) => setPreferredRegionId(e.target.value)}
              style={{ ...fieldStyle, marginTop: 4 }}
            >
              {(catalog?.regions ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.state ? ` (${r.state})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 11, color: "#aaa" }}>
            Cidade padrão ao abrir
            <select
              value={preferredCityId}
              onChange={(e) => setPreferredCityId(e.target.value)}
              style={{ ...fieldStyle, marginTop: 4 }}
            >
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label style={{ fontSize: 11, color: "#aaa" }}>
        {db ? "E-mail" : "Usuário"}
        <input
          type={db ? "email" : "text"}
          name="username"
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          style={{ ...fieldStyle, marginTop: 4 }}
        />
      </label>
      <label style={{ fontSize: 11, color: "#aaa" }}>
        Senha
        <input
          type="password"
          name="password"
          autoComplete={mode === "up" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ ...fieldStyle, marginTop: 4 }}
        />
      </label>
      {notice && (
        <p style={{ margin: 0, fontSize: 11, color: "#80ed99", lineHeight: 1.4 }}>
          {notice}
        </p>
      )}
      {error && (
        <p style={{ margin: 0, fontSize: 11, color: "#e63946" }}>{error}</p>
      )}
      <button
        type="submit"
        disabled={busy}
        style={{
          background: "#0077b6",
          border: "1px solid #00b4d8",
          color: "#fff",
          borderRadius: 6,
          padding: "8px 10px",
          cursor: busy ? "wait" : "pointer",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {mode === "up" ? "Criar conta" : "Entrar"}
      </button>
    </form>
  );
}
