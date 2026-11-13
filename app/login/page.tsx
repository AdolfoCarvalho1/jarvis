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
      <section className="login-brand" aria-label="J.A.R.V.I.S.">
        <i className="login-mark" aria-hidden="true" />
        <p className="login-kicker">Just A Rather Very Intelligent System</p>
        <h1 className="login-title">
          J.<span>A.</span>R.<span>V.</span>I.<span>S.</span>
        </h1>
        <p className="login-note">Sistema local. Acesso restrito.</p>
      </section>

      <form className="login-card" onSubmit={submit}>
        <p className="login-kicker">Chave de acesso</p>
        <label className="field">
          <span className="sr-only">Chave de acesso</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            autoComplete="current-password"
            placeholder="Digite aqui"
          />
        </label>
        {error ? <p className="login-error mono" role="alert">{error}</p> : null}
        <button type="submit" className="btn-primary" disabled={busy || !password}>
          {busy ? "VERIFICANDO…" : "ENTRAR"}
        </button>
      </form>
    </main>
  );
}
