"use client";

import { useState } from "react";
import { Button } from "@ui-sdk/react/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import { X } from "lucide-react";
import { useOwner } from "@/components/access-context";
import { changePassword, signOut } from "@/lib/access";

export function AccessControls() {
  const { owner, active } = useOwner();
  const [open, setOpen] = useState(false);
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
    <Dialog
      open={open}
      onOpenChange={(value, details) => {
        if (busy) {
          details.cancel();
          return;
        }
        setOpen(value);
        if (!value) {
          setPassword("");
          setCurrentPassword("");
          setError("");
          setMessage("");
        }
      }}
    >
      <DialogTrigger className="button settings-trigger">Settings</DialogTrigger>
      <DialogBackdrop className="dialog-backdrop" />
      <DialogContent className="settings-dialog" initialFocus="content">
        <div className="dialog-heading">
          <DialogTitle>Workspace settings</DialogTitle>
          <DialogClose
            className="button icon-button ghost"
            aria-label="Close settings"
            disabled={busy}
          >
            <X size={18} aria-hidden="true" />
          </DialogClose>
        </div>
        <div className="settings-body">
          <DialogDescription>
            Owner access for this local workspace. Your ChatGPT connection is managed separately in
            run setup.
          </DialogDescription>
          <section aria-labelledby="settings-owner">
            <h3 id="settings-owner">Owner access</h3>
            <p className="muted">Signed in as {owner.owner_name}.</p>
            {!owner.password_enabled && <p>Set an owner password to sign in on your next visit.</p>}
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
              Sessions expire after 30 minutes without activity or 12 hours after sign-in. Drafts
              stay in this browser profile. Use your own profile on a shared computer.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
