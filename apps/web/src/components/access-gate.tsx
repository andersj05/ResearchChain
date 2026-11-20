"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { LockKeyhole } from "lucide-react";
import { OwnerContext } from "@/components/access-context";
import { Workbench } from "@/components/workbench";
import { ResearchDesk } from "@/components/research-desk";
import {
  accessSnapshot,
  initializeAccess,
  lockAccess,
  ownerStoragePrefix,
  refreshAccess,
  signIn,
  subscribeAccess,
  type AccessStatus,
  type OwnerSession,
} from "@/lib/access";

export function AccessGate() {
  const [view, setView] = useState<{ status: AccessStatus | null; owner: OwnerSession | null }>({
    status: null,
    owner: null,
  });
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const starting = useRef<Promise<string> | null>(null);
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeAccess(() => {
      if (active)
        setView((previous) => {
          const status = accessSnapshot();
          return { status, owner: status?.session ?? previous.owner };
        });
    });
    starting.current ??= initializeAccess();
    void starting.current.then((message) => {
      if (active) setError(message);
    });
    const refresh = () => {
      void refreshAccess().catch(() => {
        if (active) setError("Access could not be verified. Check the connection and try again.");
      });
    };
    const openLink = () => {
      if (new URLSearchParams(window.location.hash.slice(1)).has("owner-link"))
        void initializeAccess().then((message) => {
          if (active) setError(message);
        });
    };
    const shown = (event: PageTransitionEvent) => {
      if (event.persisted) lockAccess();
      refresh();
    };
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel("researchchain.owner-access");
    if (channel)
      channel.onmessage = (event) => {
        if (event.data === "changed") refresh();
      };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("hashchange", openLink);
    window.addEventListener("pageshow", shown);
    return () => {
      active = false;
      unsubscribe();
      clearInterval(timer);
      channel?.close();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("hashchange", openLink);
      window.removeEventListener("pageshow", shown);
    };
  }, []);

  const authenticated = !!view.status?.authenticated;
  return (
    <>
      {!authenticated && (
        <main className="access-page">
          <div className="access-brand">
            ResearchChain <span>Private workspace</span>
          </div>
          <section className="access-card" aria-labelledby="access-title">
            <LockKeyhole size={24} aria-hidden="true" />
            <h1 id="access-title">
              {!view.status
                ? "Checking owner access"
                : view.owner
                  ? "Sign in again"
                  : "Owner sign-in"}
            </h1>
            <p className="muted">
              {view.owner
                ? "Your open drafts have been kept. Sign in to continue."
                : "Open your research, source library, and reports."}
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {view.status?.password_enabled && (
              <form
                className="access-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (busy) return;
                  setBusy(true);
                  setError("");
                  try {
                    await signIn(password);
                    setPassword("");
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "Sign-in was not accepted.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label htmlFor="owner-password">Owner password</label>
                <input
                  id="owner-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  maxLength={128}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
                <Button type="submit" className="button primary" disabled={busy || !password}>
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
              </form>
            )}
            {view.status && (
              <details open={!view.status.password_enabled} className="access-recovery">
                <summary>
                  {view.status.password_enabled ? "Recover owner access" : "Set up owner access"}
                </summary>
                <p>
                  On the computer running ResearchChain, open a terminal in the project and run:
                </p>
                <code>pnpm access:login</code>
                <p>
                  This opens a private, one-time sign-in link. You can then set an owner password.
                </p>
              </details>
            )}
            <Button
              className="button small"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await refreshAccess();
                } catch {
                  setError("Access is unavailable. Check that ResearchChain is running.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Check access again
            </Button>
            <p className="access-note">Your ChatGPT research connection is managed separately.</p>
          </section>
        </main>
      )}
      {view.owner && (
        <OwnerContext.Provider value={{ owner: view.owner, active: authenticated }}>
          <div
            hidden={!authenticated}
            inert={!authenticated}
            aria-hidden={!authenticated}
            data-owner-workspace={ownerStoragePrefix(view.owner)}
          >
            <OwnerWorkspace key={ownerStoragePrefix(view.owner)} />
          </div>
        </OwnerContext.Provider>
      )}
    </>
  );
}

function OwnerWorkspace() {
  // The gate mounts this component only after client-side owner authentication.
  const [query] = useState(() => new URLSearchParams(window.location.search));
  if (
    query.has("session") ||
    query.has("fromSession") ||
    query.get("view") === "research" ||
    !["view", "agent", "run", "revision"].some((key) => query.has(key))
  )
    return <ResearchDesk session={query.get("session")} fromSession={query.get("fromSession")} />;
  return <Workbench />;
}
