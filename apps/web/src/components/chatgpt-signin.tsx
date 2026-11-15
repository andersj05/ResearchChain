"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { api } from "@/lib/workflow";
import type { components } from "@researchchain/contracts";

type SignInStatus = components["schemas"]["SignInStatus"];
const activeStates = new Set(["starting", "waiting", "completing", "cancelling"]);

function entryLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      Boolean(url.port) &&
      /^\/start\/[A-Za-z0-9_-]+$/.test(url.pathname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function ChatGPTSignIn({
  connected,
  disabled,
  onConnectionChange,
}: {
  connected: boolean;
  disabled: boolean;
  onConnectionChange: () => void;
}) {
  const [status, setStatus] = useState<SignInStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const refreshed = useRef<string | null>(null);

  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      try {
        const result = await api<SignInStatus>("providers/chatgpt/sign-in");
        if (!current) return;
        setStatus(result);
        setError("");
        if (activeStates.has(result.state)) {
          timer = setTimeout(() => void read(), 1000);
        } else if (result.id && ["connected", "plan_disabled"].includes(result.state)) {
          const completion = `${result.id}:${result.state}`;
          if (refreshed.current !== completion) {
            refreshed.current = completion;
            onConnectionChange();
          }
        }
      } catch (cause) {
        if (current)
          setError(cause instanceof Error ? cause.message : "Sign-in status unavailable.");
      }
    }
    void read();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [refresh, onConnectionChange]);

  async function change(path: string) {
    setBusy(true);
    setError("");
    try {
      setStatus(await api<SignInStatus>(path, {}));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in could not be updated.");
    } finally {
      setBusy(false);
      // Resolve lost responses with a read. Never replay a start or cancellation.
      setRefresh((value) => value + 1);
    }
  }

  const active = Boolean(status && activeStates.has(status.state));
  const link = status?.state === "waiting" ? entryLink(status.url) : null;
  return (
    <div className="chatgpt-signin">
      {status && (
        <p role="status" aria-label="ChatGPT sign-in status">
          {status.message}
        </p>
      )}
      {status?.state === "waiting" && (
        <p className="field-hint">
          Allow plan usage and leave credit use disabled on the consent screen.
          {status.expires_at && (
            <>
              {" "}
              This page expires at{" "}
              {new Date(status.expires_at).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
              .
            </>
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="signin-actions">
        {status?.available && !active && (
          <Button
            className="button small"
            disabled={disabled || busy}
            onClick={() => change("providers/chatgpt/sign-in")}
          >
            {connected ? "Reconnect ChatGPT" : "Connect ChatGPT"}
          </Button>
        )}
        {link && (
          <a className="button small" href={link} target="_blank" rel="noreferrer">
            Open sign-in page
          </a>
        )}
        {status?.id && ["starting", "waiting"].includes(status.state) && (
          <Button
            className="button small subtle"
            disabled={disabled || busy}
            onClick={() => change(`providers/chatgpt/sign-in/${status.id}/cancel`)}
          >
            Cancel sign-in
          </Button>
        )}
        {error && (
          <Button
            className="button small subtle"
            disabled={disabled || busy}
            onClick={() => setRefresh((value) => value + 1)}
          >
            Check sign-in status
          </Button>
        )}
      </div>
    </div>
  );
}
