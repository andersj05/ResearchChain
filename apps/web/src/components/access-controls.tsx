"use client";

import { useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { useOwner } from "@/components/access-context";
import { changePassword, signOut } from "@/lib/access";

export function AccessControls() {
  const { owner, active } = useOwner();
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Owner access is unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="access-menu"
      onToggle={(event) => {
        if (!event.currentTarget.open) {
          setPassword("");
          setCurrentPassword("");
        }
      }}
    >
      <summary>{owner.password_enabled ? "Owner access" : "Set owner password"}</summary>
      <div className="access-menu-panel">
        <h2>Owner access</h2>
        <p className="muted">
          Signed in as {owner.owner_name}. Sessions expire after 30 minutes without activity or 12
          hours after sign-in.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <form
          className="access-form"
          onSubmit={(event) => {
            event.preventDefault();
            void action(async () => {
              await changePassword(password, currentPassword);
              setPassword("");
              setCurrentPassword("");
              setMessage(
                "Password saved. Other sessions and pending sign-in links were signed out.",
              );
            });
          }}
        >
          {owner.password_enabled && (
            <>
              <label htmlFor="current-owner-password">Current password</label>
              <input
                id="current-owner-password"
                type="password"
                autoComplete="current-password"
                maxLength={128}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                disabled={busy || !active}
                required={!owner.recent_authentication}
              />
            </>
          )}
          <label htmlFor="new-owner-password">
            {owner.password_enabled ? "New password" : "Create owner password"}
          </label>
          <input
            id="new-owner-password"
            type="password"
            autoComplete="new-password"
            minLength={15}
            maxLength={128}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy || !active}
            aria-describedby="password-help"
          />
          <p id="password-help" className="muted">
            Use 15–128 characters. A long, unique passphrase works well.
          </p>
          {!owner.password_enabled && !owner.recent_authentication && (
            <p className="muted">
              Open a new owner sign-in link before setting your first password.
            </p>
          )}
          <Button
            type="submit"
            className="button primary"
            disabled={busy || !active || password.length < 15}
          >
            Save owner password
          </Button>
        </form>
        <div className="actions">
          <Button
            className="button"
            disabled={busy || !active}
            onClick={() =>
              action(async () => {
                await signOut();
              })
            }
          >
            Sign out
          </Button>
          <Button
            className="button"
            disabled={busy || !active}
            onClick={() =>
              action(async () => {
                await signOut(true);
              })
            }
          >
            Sign out all sessions
          </Button>
        </div>
        <p className="access-note">
          Drafts stay in this browser profile. Use your own profile on a shared computer.
        </p>
      </div>
    </details>
  );
}
