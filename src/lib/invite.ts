import { ConvexError } from "convex/values";
import { normalizeInviteCode } from "@convex/lib/inviteCode";

/**
 * An Invite link (`/pozvanka/K7M-2QX`) is opened before sign-in, and Google
 * sign-in returns to `/plan` (a redirect target must not redirect again, see
 * SignIn). So the code is parked in localStorage until it has been redeemed.
 */
const KEY = "kuchsistent.pendingInvite";

export function capturePendingInvite(): string | null {
  const m = /^\/pozvanka\/([^/]+)/.exec(window.location.pathname);
  const fromUrl = m ? normalizeInviteCode(decodeURIComponent(m[1])) : null;
  try {
    if (fromUrl) localStorage.setItem(KEY, fromUrl);
    return fromUrl ?? localStorage.getItem(KEY);
  } catch {
    return fromUrl;
  }
}

export function clearPendingInvite(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: nothing was parked.
  }
}

const MESSAGES: Record<string, string> = {
  INVITE_NOT_FOUND: "Taková pozvánka neexistuje. Zkontroluj kód.",
  INVITE_USED: "Tahle pozvánka už byla použita. Požádej o novou.",
  INVITE_EXPIRED: "Platnost pozvánky vypršela (platí 7 dní). Požádej o novou.",
  ALREADY_A_MEMBER: "Už jsi členem domácnosti, pozvánku nemůžeš použít.",
};

export function inviteErrorMessage(err: unknown): string {
  const code = err instanceof ConvexError ? (err.data as { code?: string })?.code : undefined;
  return (code && MESSAGES[code]) ?? "Pozvánku se nepodařilo použít, zkus to znovu.";
}
