"use client";

import { useId, useState } from "react";

/**
 * Sign in / register.
 *
 * One component for both because they differ only in the endpoint and the
 * wording — two near-identical files would drift.
 */
export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const ids = { email: useId(), password: useId() };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const body = (await response.json()) as { error?: string; detail?: string };
      setError(body.detail ?? body.error ?? "That did not work.");
      setBusy(false);
      return;
    }

    // A full navigation, not a client-side push: the session cookie was just
    // set and the server components need to be re-rendered with it.
    window.location.href = "/";
  }

  return (
    <form onSubmit={submit}>
      <div aria-live="polite">
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <label htmlFor={ids.email}>Email</label>
      <input
        id={ids.email}
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <label htmlFor={ids.password}>
        Password{" "}
        {mode === "register" ? (
          <span className="hint">at least 12 characters</span>
        ) : null}
      </label>
      <input
        id={ids.password}
        type="password"
        autoComplete={mode === "register" ? "new-password" : "current-password"}
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <button type="submit" disabled={busy}>
        {busy ? "Working…" : mode === "register" ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
