import type { components } from "@researchchain/contracts";

export type OwnerSession = components["schemas"]["OwnerSession"];
export type AccessStatus = components["schemas"]["AccessStatus"];

let current: AccessStatus | null = null;
let version = 0;
const listeners = new Set<() => void>();
let refreshing: Promise<AccessStatus> | null = null;

export function accessSnapshot() {
  return current;
}

export function subscribeAccess(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(status: AccessStatus) {
  current = status;
  version += 1;
  for (const listener of listeners) listener();
  return status;
}

function announce() {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("researchchain.owner-access");
  channel.postMessage("changed");
  channel.close();
}

async function accessRequest<T = AccessStatus>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/access/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? undefined
        : {
            "Content-Type": "application/json",
            ...(current?.session ? { "X-ResearchChain-CSRF": current.session.csrf_token } : {}),
          },
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      typeof payload?.detail === "string" ? payload.detail : "Owner access is unavailable.",
    );
  }
  return response.json();
}

export function lockAccess() {
  if (current?.authenticated) publish({ ...current, authenticated: false, session: null });
}

export function refreshAccess(): Promise<AccessStatus> {
  if (refreshing) return refreshing;
  const started = version;
  refreshing = accessRequest("status")
    .then((status) => {
      if (started === version) return publish(status);
      return current ?? status;
    })
    .catch((error: unknown) => {
      if (started === version) lockAccess();
      throw error;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function changeAccess(path: string, body: unknown) {
  version += 1; // An older status response must not undo a completed sign-in.
  const result = await accessRequest(path, body).catch((error: unknown) => {
    if (path === "password") void refreshAccess().catch(() => undefined);
    throw error;
  });
  publish(result);
  announce();
  return result;
}

export function signIn(password: string) {
  return changeAccess("login", { password });
}

export function changePassword(password: string, currentPassword: string) {
  return changeAccess("password", { password, current_password: currentPassword || null });
}

export async function signOut(all = false) {
  version += 1;
  await accessRequest<unknown>(all ? "logout-all" : "logout", {}).catch((error: unknown) => {
    void refreshAccess().catch(() => undefined);
    throw error;
  });
  publish({
    authenticated: false,
    password_enabled: current?.password_enabled ?? false,
    session: null,
  });
  announce();
}

export async function initializeAccess(): Promise<string> {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const code = fragment.get("owner-link");
  if (code !== null) {
    // Remove the one-time secret before any request or navigation. Never persist it.
    fragment.delete("owner-link");
    const remaining = fragment.toString();
    history.replaceState(
      history.state,
      "",
      window.location.pathname + window.location.search + (remaining ? `#${remaining}` : ""),
    );
  }
  try {
    if (code !== null) await changeAccess("exchange", { code });
    else await refreshAccess();
    return "";
  } catch (error) {
    if (code !== null) await refreshAccess().catch(() => undefined);
    return error instanceof Error ? error.message : "Unable to check owner access.";
  }
}

/** Only local API requests receive the session's CSRF token. Mutations are never replayed. */
export async function apiFetch(path: string, init: RequestInit = {}) {
  const target = new URL(path, window.location.origin);
  if (
    !path.startsWith("/api/") ||
    target.origin !== window.location.origin ||
    !target.pathname.startsWith("/api/")
  )
    throw new Error("Use a local research API path.");
  if (!current?.session) throw new Error("Sign in again to continue. Your draft has been kept.");
  const started = version;
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method))
    headers.set("X-ResearchChain-CSRF", current.session.csrf_token);
  const response = await fetch(target, {
    ...init,
    headers,
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
  });
  if ((response.status === 401 || response.status === 403) && started === version) {
    if (response.status === 401) lockAccess();
    void refreshAccess().catch(() => undefined);
  }
  return response;
}

export function ownerStoragePrefix(owner: Pick<OwnerSession, "workspace_id" | "owner_id">) {
  return `researchchain.owner.${owner.workspace_id}.${owner.owner_id}`;
}

const legacyClaim = "researchchain.legacy-drafts.owner";
export function legacyDraftAvailable(key: string, prefix: string) {
  try {
    const claim = localStorage.getItem(legacyClaim);
    return (!claim || claim === prefix) && localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

/** Explicit owner action only; pre-sign-in drafts are never loaded automatically. */
export function importLegacyDraft(key: string, prefix: string) {
  if (!legacyDraftAvailable(key, prefix)) throw new Error("No unclaimed older draft is available.");
  const raw = localStorage.getItem(key);
  if (!raw) throw new Error("The older draft is empty.");
  localStorage.setItem(legacyClaim, prefix);
  return raw;
}
