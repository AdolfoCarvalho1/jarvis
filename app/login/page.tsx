"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    if (!response?.ok) {
      setError(response?.status === 401 ? "Senha incorreta. Tente novamente." : "Não foi possível entrar agora. Tente novamente.");
      setBusy(false);
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(next === "/hud" ? "/hud" : "/");
    router.refresh();
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <h1 className="login-title">
          J.<span>A.</span>R.<span>V.</span>I.<span>S.</span>
        </h1>
        <p className="login-sub">
          Just A Rather Very Intelligent System
          <br />
          Identifique-se para iniciar a sessão.
        </p>
        <label className="field">
          <span className="mono">CHAVE DE ACESSO</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </label>
        {error ? <p className="login-error mono">{error}</p> : null}
        <button type="submit" className="btn-primary" disabled={busy || !password}>
          {busy ? "VERIFICANDO…" : "ENTRAR"}
        </button>
      </form>
    </main>
  );
}
