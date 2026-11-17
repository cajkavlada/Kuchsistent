import { useConvex, useMutation, useQuery } from "convex/react";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  keepAfterError,
  parseSavedList,
  parseTicks,
  snapshotOf,
  withoutTick,
  withTick,
  type SavedList,
  type ShoppingData,
  type Ticks,
} from "~/lib/offline";
import { errorCode } from "~/lib/shopping";
import { useOnline } from "~/pwa";

/**
 * Shopping list with poor signal (#13, #32): the connection state, the
 * device's copy of the list, and the persisted queue of unconfirmed ticks.
 *
 * Ticks never go to the server directly: the list puts them in the queue
 * (localStorage), and `TickSync`, mounted only while signed in as a Member,
 * sends them. Convex holds a sent mutation while disconnected and delivers it
 * on reconnect; the copy in storage covers the page being killed meanwhile,
 * a cold start without signal and an expired session.
 */

const LIST_KEY = "kuchsistent:shoppingList";
const TICKS_KEY = "kuchsistent:ticks";
const TRIP_KEY = "kuchsistent:lastTrip";
/** How long disconnected before the app says it's offline. */
export const OFFLINE_AFTER_MS = 3000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage full or unavailable: the copy just doesn't persist.
  }
}

// Module-level caches, so useSyncExternalStore gets stable snapshots.
let ticks: Ticks | null = null;
let saved: SavedList | null | undefined;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const notify = () => listeners.forEach((l) => l());

function getTicks(): Ticks {
  if (ticks === null) ticks = typeof window === "undefined" ? {} : parseTicks(read(TICKS_KEY));
  return ticks;
}

function setTicks(next: Ticks) {
  if (next === getTicks()) return;
  ticks = next;
  write(TICKS_KEY, Object.keys(next).length ? JSON.stringify(next) : null);
  notify();
}

function getSaved(): SavedList | null {
  if (saved === undefined) saved = typeof window === "undefined" ? null : parseSavedList(read(LIST_KEY));
  return saved;
}

let seq = 0;
/** Ticks an item (sets, never toggles); shown at once, sent by `TickSync`. */
export function queueTick(itemId: string, checked: boolean) {
  seq = Math.max(seq + 1, Date.now());
  setTicks(withTick(getTicks(), itemId, checked, seq));
}

export function usePendingTicks(): Ticks {
  return useSyncExternalStore(subscribe, getTicks, () => ({}));
}

export function useSavedList(): SavedList | null {
  return useSyncExternalStore(subscribe, getSaved, () => null);
}

export function hasSavedList(): boolean {
  return getSaved() !== null;
}

export function pendingTickCount(): number {
  return Object.keys(getTicks()).length;
}

export function saveList(data: ShoppingData) {
  saved = snapshotOf(data, Date.now());
  write(LIST_KEY, JSON.stringify(saved));
  notify();
}

/** The Shopping Trip last open on this device. */
export function lastTrip(): string | null {
  return read(TRIP_KEY);
}

export function rememberTrip(id: string) {
  write(TRIP_KEY, id);
}

/** "Odhlásit se": the saved copy and unsent ticks go too. */
export function clearOfflineData() {
  write(LIST_KEY, null);
  write(TICKS_KEY, null);
  write(TRIP_KEY, null);
  saved = null;
  ticks = {};
  notify();
}

/**
 * `connected`: online with Convex's WebSocket open right now. `offline`: not
 * connected for ~3 s (banner, disabled actions). `noNetwork`: the browser
 * itself says it's offline.
 */
export function useConnection(): { connected: boolean; offline: boolean; noNetwork: boolean } {
  const client = useConvex();
  const online = useOnline();
  const [ws, setWs] = useState(() => client.connectionState().isWebSocketConnected);
  useEffect(() => {
    setWs(client.connectionState().isWebSocketConnected);
    return client.subscribeToConnectionState((s) => setWs(s.isWebSocketConnected));
  }, [client]);
  const connected = online && ws;
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (connected) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), OFFLINE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [connected]);
  return { connected, offline: !connected && late, noNetwork: !online };
}

/**
 * True inside the offline start screen (`OfflineShell` in the Gate): opened
 * without signal, not yet signed in, so only the saved copy can show.
 */
export const OfflineShellContext = createContext(false);

export function useOfflineShell(): boolean {
  return useContext(OfflineShellContext);
}

/**
 * Whether changes other than ticking are off ("Bez připojení"): offline for
 * a while, or showing the saved copy rather than live data.
 */
export function useLocked(): boolean {
  const shell = useOfflineShell();
  const { offline } = useConnection();
  return shell || offline;
}

/** Sends queued ticks; mounted only while signed in as a Member. */
export function TickSync() {
  const setChecked = useMutation(api.shopping.setChecked);
  const pending = usePendingTicks();
  const sent = useRef(new Map<string, number>());

  useEffect(() => {
    for (const [id, tick] of Object.entries(pending)) {
      if (sent.current.get(id) === tick.seq) continue;
      sent.current.set(id, tick.seq);
      const done = () => {
        if (sent.current.get(id) === tick.seq) sent.current.delete(id);
      };
      setChecked({ itemId: id as Id<"shoppingItems">, checked: tick.checked }).then(
        () => {
          done();
          setTicks(withoutTick(getTicks(), id, tick.seq));
        },
        (err: unknown) => {
          done();
          // Session expired: keep it for after sign-in. Anything else can't be fixed by resending.
          if (!keepAfterError(errorCode(err))) setTicks(withoutTick(getTicks(), id, tick.seq));
        },
      );
    }
  }, [pending, setChecked]);

  return null;
}

/** Keeps the device's copy of the list fresh on every update. */
export function ListKeeper() {
  const list = useQuery(api.shopping.list, {});
  useEffect(() => {
    if (list) saveList(list);
  }, [list]);
  return null;
}
