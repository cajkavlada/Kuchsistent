import { useSyncExternalStore } from "react";

/**
 * Installable app shell (#16): service worker registration, Chrome's install
 * prompt, and the online flag. Listeners are attached when this module loads
 * in the browser, because `beforeinstallprompt` can fire before React mounts.
 */

/** Chrome's install prompt event (not in the TS DOM lib). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "kuchsistent:installDismissed";
const MEMBER_KEY = "kuchsistent:member";
const CHUNK_RELOAD_KEY = "kuchsistent:chunkReloadAt";
/** Don't reload again within this window, so a broken deploy can't loop. */
const CHUNK_RELOAD_WINDOW_MS = 30_000;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own button
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);

  // A page running an older deploy's HTML can ask for a route chunk that no
  // longer exists, and the app then never leaves "Načítám…". Reloading picks
  // up the current deploy (the service worker has the new shell by then).
  window.addEventListener("vite:preloadError", (e) => {
    if (reloadForStaleChunk()) e.preventDefault();
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (isChunkLoadError(e.reason)) reloadForStaleChunk();
  });

  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
      // updateViaCache "none": always revalidate sw.js, so deploys roll out.
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch((err) => console.error("Service worker registration failed", err));
    });
  }
}

export function isChunkLoadError(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(
    message,
  );
}

export function shouldReloadForChunk(lastReloadAt: number | null, now: number): boolean {
  return lastReloadAt === null || now - lastReloadAt > CHUNK_RELOAD_WINDOW_MS;
}

/** Reloads the page once per window; true if it did. */
function reloadForStaleChunk(): boolean {
  let last: number | null = null;
  try {
    const raw = sessionStorage.getItem(CHUNK_RELOAD_KEY);
    last = raw === null ? null : Number(raw);
  } catch {
    // Storage unavailable: still reload, the window guard just won't persist.
  }
  const now = Date.now();
  if (!shouldReloadForChunk(last, now)) return false;
  try {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    // ignore
  }
  window.location.reload();
  return true;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Android TWA / older Chrome
    document.referrer.startsWith("android-app://")
  );
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    if (value) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    // Storage unavailable: the flag just doesn't persist.
  }
}

export function shouldOfferInstall(state: {
  hasPrompt: boolean;
  standalone: boolean;
  dismissed: boolean;
}): boolean {
  return state.hasPrompt && !state.standalone && !state.dismissed;
}

/** The "Instalovat aplikaci" offer: visible, install(), dismiss(). */
export function useInstallOffer() {
  const visible = useSyncExternalStore(
    subscribe,
    () =>
      shouldOfferInstall({
        hasPrompt: deferredPrompt !== null,
        standalone: isStandalone(),
        dismissed: readFlag(DISMISSED_KEY),
      }),
    () => false,
  );

  async function install() {
    const prompt = deferredPrompt;
    if (!prompt) return;
    // A prompt event can be used once; Chrome fires a new one if declined.
    deferredPrompt = null;
    notify();
    await prompt.prompt();
    await prompt.userChoice;
  }

  function dismiss() {
    writeFlag(DISMISSED_KEY, true);
    notify();
  }

  return { visible, install, dismiss };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Whether this device last saw the user as a Household Member. Offline, the
 * server can't tell us, so this decides whether to show the app's tabs.
 */
export function rememberMember(isMember: boolean) {
  writeFlag(MEMBER_KEY, isMember);
}

export function wasMember(): boolean {
  return readFlag(MEMBER_KEY);
}
