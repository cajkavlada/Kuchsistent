import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { APP_TIME_ZONE, today as pragueToday } from "@convex/lib/dates";

/**
 * Shopping list with poor signal (#13, #32), the pure part: the saved copy of
 * the list, the queue of unconfirmed ticks, and how they combine on screen.
 * Storage and React live in `~/offline`.
 */

export type ShoppingData = FunctionReturnType<typeof api.shopping.list>;
export type ShoppingTrip = ShoppingData["trips"][number];

/** Bump when the saved shape changes: an older copy is then ignored. */
export const SAVED_LIST_VERSION = 1;

/** The device's copy of every Shopping Trip not marked done. */
export type SavedList = { v: number; savedAt: number; trips: ShoppingTrip[] };

/**
 * A tick waiting for the server: the state to set (never a toggle, so a
 * repeated send is harmless) and a sequence number telling a newer tick of
 * the same item from the one already sent.
 */
export type PendingTick = { checked: boolean; seq: number };
export type Ticks = Readonly<Record<string, PendingTick>>;

export function snapshotOf(data: ShoppingData, now: number): SavedList {
  return { v: SAVED_LIST_VERSION, savedAt: now, trips: data.trips.filter((t) => t.status !== "done") };
}

/** A saved copy read back from storage, or null if missing or outdated. */
export function parseSavedList(raw: string | null): SavedList | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedList>;
    if (value.v !== SAVED_LIST_VERSION || typeof value.savedAt !== "number" || !Array.isArray(value.trips)) {
      return null;
    }
    return value as SavedList;
  } catch {
    return null;
  }
}

/** The saved copy as list data, dated today (its own `today` may be stale). */
export function listFromSaved(saved: SavedList, today = pragueToday()): ShoppingData {
  return { today, trips: saved.trips };
}

export function parseTicks(raw: string | null): Ticks {
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const out: Record<string, PendingTick> = {};
    for (const [id, t] of Object.entries(value as Record<string, unknown>)) {
      const tick = t as Partial<PendingTick> | null;
      if (tick && typeof tick.checked === "boolean" && typeof tick.seq === "number") {
        out[id] = { checked: tick.checked, seq: tick.seq };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function withTick(ticks: Ticks, itemId: string, checked: boolean, seq: number): Ticks {
  return { ...ticks, [itemId]: { checked, seq } };
}

/** The server confirmed tick `seq`; a newer tick of the same item stays. */
export function withoutTick(ticks: Ticks, itemId: string, seq: number): Ticks {
  if (ticks[itemId]?.seq !== seq) return ticks;
  const { [itemId]: _confirmed, ...rest } = ticks;
  return rest;
}

/** Pending ticks laid over the list: rows show what the user ticked. */
export function applyTicks(data: ShoppingData, ticks: Ticks): ShoppingData {
  if (Object.keys(ticks).length === 0) return data;
  return {
    ...data,
    trips: data.trips.map((t) => ({
      ...t,
      items: t.items.map((i) => {
        const tick = ticks[i._id];
        return tick && tick.checked !== i.checked ? { ...i, checked: tick.checked } : i;
      }),
    })),
  };
}

/**
 * Whether a failed tick should wait for sign-in (kept) or is dropped. The
 * server ignores ticks of items that no longer exist, so the only other
 * failures are ones a resend can't fix.
 */
export function keepAfterError(code: string | undefined): boolean {
  return code === "UNAUTHENTICATED";
}

/** "14:05", or "15. 11. 14:05" when the copy is from another day. */
export function savedAtLabel(savedAt: number, now: number): string {
  const time = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(savedAt);
  const day = (ms: number) =>
    new Intl.DateTimeFormat("cs-CZ", { timeZone: APP_TIME_ZONE, day: "numeric", month: "numeric" }).format(ms);
  return day(savedAt) === day(now) ? time : `${day(savedAt)} ${time}`;
}

/** "1 odškrtnutí se ještě neuložilo – opravdu odhlásit?" */
export function signOutQuestion(pending: number): string {
  const verb = pending === 1 ? "se ještě neuložilo" : pending <= 4 ? "se ještě neuložila" : "se ještě neuložilo";
  return `${pending} odškrtnutí ${verb} – opravdu odhlásit?`;
}
