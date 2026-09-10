import { useState, type CSSProperties, type FormEvent } from "react";
import { isDatabaseEnabled, loginAppUser, signUpAppUser } from "./auth";

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
  onLoggedIn,
}: {
  onLoggedIn: (name: string, userId: string, role: string) => void;
}) {
  const db = isDatabaseEnabled();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = async (mode: "in" | "up") => {
    setBusy(true);
    setError(null);
    try {
      const user =
        mode === "up"
          ? await signUpAppUser(identifier, password, displayName || identifier)
          : await loginAppUser(identifier, password);
      onLoggedIn(user.name, user.id, user.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login.");
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void finish("in");
  };

  return (
    <form
      onSubmit={submit}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <p style={{ margin: 0, fontSize: 11, color: "#888", lineHeight: 1.4 }}>
        {db
          ? "Entre com e-mail e senha da conta Vale Alerta. As demarcações gravam no banco na hora."
          : "Banco não configurado (VITE_SUPABASE_URL). Modo local: nome + senha 123."}
      </p>
      {db && (
        <label style={{ fontSize: 11, color: "#aaa" }}>
          Nome (só na criação da conta)
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            style={{ ...fieldStyle, marginTop: 4 }}
          />
        </label>
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
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ ...fieldStyle, marginTop: 4 }}
        />
      </label>
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
        Entrar para demarcar
      </button>
      {db && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void finish("up")}
          style={{
            background: "#2d2d2d",
            border: "1px solid #444",
            color: "#fff",
            borderRadius: 6,
            padding: "8px 10px",
            cursor: busy ? "wait" : "pointer",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Criar conta
        </button>
      )}
    </form>
  );
}
