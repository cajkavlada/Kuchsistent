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

  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
      // updateViaCache "none": always revalidate sw.js, so deploys roll out.
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch((err) => console.error("Service worker registration failed", err));
    });
  }
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
