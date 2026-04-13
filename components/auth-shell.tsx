"use client";

import { useState, useTransition } from "react";

type AuthMode = "login" | "signup";

export function AuthShell() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function submit() {
    setError(null);

    startTransition(async () => {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, email, password }),
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Authentication failed.");
        return;
      }

      window.location.reload();
    });
  }

  return (
    <main className="shell auth-shell">
      <section className="hero auth-hero">
        <div className="hero-topbar">
          <span className="eyebrow">Bonus feature: User Login and Signup</span>
        </div>
        <h1>Meet AI Scribe</h1>
        <p>
          Sign in to launch Google Meet bot sessions, save transcripts, and keep
          your generated summaries tied to your own account.
        </p>
      </section>

      <section className="auth-card">
        <div className="auth-tabs" role="tablist" aria-label="Authentication">
          <button
            className={mode === "login" ? "auth-tab active" : "auth-tab"}
            onClick={() => setMode("login")}
            type="button"
          >
            Log in
          </button>
          <button
            className={mode === "signup" ? "auth-tab active" : "auth-tab"}
            onClick={() => setMode("signup")}
            type="button"
          >
            Sign up
          </button>
        </div>

        <div className="stack">
          <div>
            <h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
            <p>
              {mode === "login"
                ? "Use your saved credentials to access your bot runs and summaries."
                : "Make an account to keep your transcripts and summaries private and persistent."}
            </p>
          </div>

          {mode === "signup" ? (
            <div className="field">
              <label htmlFor="name">Full name</label>
              <input
                id="name"
                className="input"
                onChange={(event) => setName(event.target.value)}
                placeholder="Divyansh Mundra"
                value={name}
              />
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              type="email"
              value={email}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              type="password"
              value={password}
            />
          </div>

          <button className="button" disabled={isPending} onClick={submit} type="button">
            {isPending
              ? mode === "login"
                ? "Logging in..."
                : "Creating account..."
              : mode === "login"
                ? "Log in"
                : "Create account"}
          </button>

          {error ? <p className="note">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}
