import { useState, type CSSProperties, type FormEvent } from "react";
import { tryDummyLogin } from "./dummyAuth";
import { InfoTip } from "./InfoTip";

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

export function PatchLoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!tryDummyLogin(username, password)) {
      setError("Usuário ou senha inválidos.");
      return;
    }
    setError(null);
    onLoggedIn();
  };

  return (
    <form
      onSubmit={submit}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <p style={{ margin: 0, fontSize: 11, color: "#888", lineHeight: 1.4 }}>
        Demarcar aterro exige autorização. Entre com a conta provisória.
        <InfoTip text="Login dummy até existir autenticação de verdade. Usuário autorizado: usuario. Só depois disso o formulário de polígono e Δz aparece." />
      </p>
      <label style={{ fontSize: 11, color: "#aaa" }}>
        Usuário
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
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
        style={{
          background: "#0077b6",
          border: "1px solid #00b4d8",
          color: "#fff",
          borderRadius: 6,
          padding: "8px 10px",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        Entrar para demarcar
      </button>
    </form>
  );
}
