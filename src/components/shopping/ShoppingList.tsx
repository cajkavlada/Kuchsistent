import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { dayLabel } from "~/lib/plan";
import {
  freshBadge,
  freshCount,
  groupBySection,
  itemAmount,
  noteTone,
  progress,
  errorCode,
  shoppingError,
  splitPlenty,
} from "~/lib/shopping";
import { rohlikSearchUrl } from "~/lib/rohlik";
import { applyTicks, listFromSaved, savedAtLabel, type Ticks } from "~/lib/offline";
import {
  lastTrip,
  queueTick,
  rememberTrip,
  useConnection,
  useLocked,
  useOfflineShell,
  usePendingTicks,
  useSavedList,
} from "~/offline";
import { ItemSheet } from "./ItemSheet";
import { RohlikCard } from "./RohlikCard";
import { AddTripSheet, TripMenuSheet } from "./TripSheets";

type List = FunctionReturnType<typeof api.shopping.list>;
type Trip = List["trips"][number];
type Item = Trip["items"][number];

/** How long a row flashes after the other phone ticks it. */
const FLASH_MS = 1600;

/**
 * Nákup, variant A of #10: trip tabs (with "+" to add a trip, #30), then one
 * Shopping Trip grouped by Store Section, with Plenty items in a "Máme dost"
 * box at the bottom (#29). The trip's "⋯" menu switches, moves, deletes and
 * closes it; the field on top adds Manual Shopping Items (#30). Ticks are
 * live for both Members. Tapping the circle ticks; tapping the name opens
 * the item sheet. A Rohlík trip gets the hand-off card and a "🔎 Rohlík"
 * search link on each unticked row (#31); there a tick means "in the cart".
 *
 * Poor signal (#13, #32): ticks go through the persisted queue in
 * `~/offline` and show at once (⏳ until the server has them). Without live
 * data the device's saved copy shows ("Offline · seznam z HH:MM"); offline,
 * everything but ticking is disabled.
 */
export function ShoppingList() {
  const shell = useOfflineShell();
  const live = useQuery(api.shopping.list, shell ? "skip" : {});
  const saved = useSavedList();
  const pending = usePendingTicks();
  const { connected } = useConnection();
  const offline = useLocked();
  const refresh = useMutation(api.shopping.refresh);
  useEffect(() => {
    // Brings the list up to date when opened (e.g. after midnight).
    if (!shell) refresh({}).catch(() => {});
  }, [refresh, shell]);

  const setPlenty = useMutation(api.ingredients.setPlenty).withOptimisticUpdate(
    (store, { ingredientId, plenty }) => {
      const cur = store.getQuery(api.shopping.list, {});
      if (cur) {
        store.setQuery(api.shopping.list, {}, {
          ...cur,
          trips: cur.trips.map((t) => ({
            ...t,
            items: t.items.map((i) =>
              i.ingredient === ingredientId && !i.manual
                ? { ...i, plenty, fresh: plenty ? null : i.fresh }
                : i,
            ),
          })),
        });
      }
    },
  );

  const { flashing, markMine } = useRemoteFlash(live);
  const [selected, setSelected] = useState<Id<"shoppingTrips"> | null>(
    () => lastTrip() as Id<"shoppingTrips"> | null,
  );
  const [open, setOpen] = useState<Id<"shoppingItems"> | null>(null);
  const [sheet, setSheet] = useState<"addTrip" | "menu" | null>(null);

  // The saved copy stands in until live data comes (quietly, when online).
  const fromCopy = live === undefined && saved !== null;
  const base = live ?? (saved ? listFromSaved(saved) : undefined);
  const data = useMemo(() => base && applyTicks(base, pending), [base, pending]);
  const locked = offline || fromCopy;
  const copyNote = fromCopy && (shell || !connected) && (
    <p className="offline-copy">Offline · seznam z {savedAtLabel(saved.savedAt, Date.now())}</p>
  );

  if (data === undefined) {
    return (
      <section className="page">
        <h1>Nákup</h1>
        <p className="muted">{shell ? "Bez připojení. Seznam se načte, jakmile bude signál." : "Načítám…"}</p>
      </section>
    );
  }
  if (data.trips.length === 0) {
    return (
      <section className="page">
        <h1>Nákup</h1>
        {copyNote}
        <div className="card center-text">
          <p className="muted">Zatím není co nakoupit.</p>
          <p className="muted small">
            Naplánuj jídla a nákupní seznam se z nich vytvoří sám.
          </p>
          <Link to="/plan" className="btn primary">
            Otevřít plán
          </Link>
          <button className="btn" disabled={locked} onClick={() => setSheet("addTrip")}>
            ＋ Přidat nákup
          </button>
        </div>
        {sheet === "addTrip" && !locked && (
          <AddTripSheet
            today={data.today}
            takenDays={new Set()}
            onClose={() => setSheet(null)}
            onAdded={(id) => {
              select(id);
              setSheet(null);
            }}
          />
        )}
      </section>
    );
  }

  function select(id: Id<"shoppingTrips">) {
    setSelected(id);
    rememberTrip(id);
  }

  const trip =
    data.trips.find((t) => t._id === selected) ??
    data.trips.find((t) => t.date >= data.today) ??
    data.trips[0];

  function tick(item: Item) {
    markMine(item._id);
    queueTick(item._id, !item.checked);
  }
  function plenty(ingredientId: Id<"ingredients">, value: boolean) {
    setPlenty({ ingredientId, plenty: value }).catch(() => {});
  }

  return (
    <section className="page shop">
      <h1>Nákup</h1>
      {copyNote}
      <TripTabs
        trips={data.trips}
        current={trip._id}
        locked={locked}
        onSelect={select}
        onAdd={() => setSheet("addTrip")}
      />
      <TripView
        trip={trip}
        today={data.today}
        locked={locked}
        waiting={connected && !shell ? null : pending}
        onMenu={() => setSheet("menu")}
        flashing={flashing}
        onTick={tick}
        onOpen={(i) => setOpen(i._id)}
        onRunningLow={(i) => i.ingredient && plenty(i.ingredient, false)}
      />
      {open && (
        <ItemSheet itemId={open} locked={locked} onClose={() => setOpen(null)} onPlenty={plenty} />
      )}
      {sheet === "menu" && !locked && (
        <TripMenuSheet trip={trip} today={data.today} onClose={() => setSheet(null)} />
      )}
      {sheet === "addTrip" && !locked && (
        <AddTripSheet
          today={data.today}
          takenDays={new Set(data.trips.map((t) => t.date))}
          onClose={() => setSheet(null)}
          onAdded={(id) => {
            select(id);
            setSheet(null);
          }}
        />
      )}
    </section>
  );
}

function TripTabs({
  trips,
  current,
  locked,
  onSelect,
  onAdd,
}: {
  trips: Trip[];
  current: Id<"shoppingTrips">;
  locked: boolean;
  onSelect: (id: Id<"shoppingTrips">) => void;
  onAdd: () => void;
}) {
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);
  return (
    <div className="trip-tabs" role="tablist" aria-label="Nákupy">
      {trips.map((t) => {
        const p = progress(splitPlenty(t.items).list);
        const done = t.status === "done" || (p.total > 0 && p.left === 0);
        return (
          <button
            key={t._id}
            ref={t._id === current ? active : undefined}
            role="tab"
            aria-selected={t._id === current}
            className={`trip-tab${t._id === current ? " on" : ""}${t.kind === "rohlik" ? " rl" : ""}`}
            onClick={() => onSelect(t._id)}
          >
            <b>{dayLabel(t.date)}</b>
            <span>
              {t.kind === "rohlik" ? "🚚" : "🛒"} {done ? "hotovo" : `${p.left} zbývá`}
            </span>
          </button>
        );
      })}
      <button
        className="trip-tab add"
        aria-label={locked ? "Přidat nákup – bez připojení" : "Přidat nákup"}
        disabled={locked}
        onClick={onAdd}
      >
        ＋
      </button>
    </div>
  );
}

function TripView({
  trip,
  today,
  locked,
  waiting,
  onMenu,
  flashing,
  onTick,
  onOpen,
  onRunningLow,
}: {
  trip: Trip;
  today: string;
  /** Offline or showing the saved copy: only ticking works. */
  locked: boolean;
  /** Ticks to mark ⏳ (not yet on the server); null while connected. */
  waiting: Ticks | null;
  onMenu: () => void;
  flashing: Set<string>;
  onTick: (item: Item) => void;
  onOpen: (item: Item) => void;
  onRunningLow: (item: Item) => void;
}) {
  const { list, plenty } = splitPlenty(trip.items);
  const p = progress(list);
  const warnings = freshCount(list);
  const groups = groupBySection(list);
  const rohlik = trip.kind === "rohlik";
  return (
    <>
      <div className="trip-head">
        <h2>
          {dayLabel(trip.date)}
          {trip.date === today ? " · dnes" : ""}
        </h2>
        <span className={`kind${trip.kind === "rohlik" ? " rl" : ""}`}>
          {trip.kind === "rohlik" ? "🚚 Rohlík" : "🛒 Obchod"}
        </span>
        <button
          className="icon-btn small"
          aria-label={locked ? "Možnosti nákupu – bez připojení" : "Možnosti nákupu"}
          disabled={locked}
          onClick={onMenu}
        >
          ⋯
        </button>
      </div>
      <div className="pbar" aria-hidden="true">
        <i style={{ width: `${p.total ? (100 * p.done) / p.total : 0}%` }} />
      </div>
      <p className="muted small">
        {p.done} z {p.total} odškrtnuto
        {warnings > 0 && <span className="warn-text"> · ⚠ {warnings} nebude čerstvé</span>}
        {trip.status === "done" && " · nákup hotový"}
      </p>
      {trip.status === "planned" && trip.date >= today && (
        <AddItem key={trip._id} tripId={trip._id} locked={locked} />
      )}
      {rohlik && trip.status === "planned" && <RohlikCard date={trip.date} items={trip.items} locked={locked} />}
      {groups.length === 0 && plenty.length === 0 && (
        <p className="muted">Na tenhle nákup zatím nic není.</p>
      )}
      {groups.map((g) => (
        <div key={g.section} className="ssec">
          <h3>
            {g.label} <span>{g.left || "✓"}</span>
          </h3>
          <ul className="srows">
            {g.items.map((i) => (
              <li key={i._id}>
                <div className={`srow${i.checked ? " done" : ""}${flashing.has(i._id) ? " flash" : ""}`}>
                  <button
                    className="ck"
                    aria-pressed={i.checked}
                    aria-label={`${i.checked ? "Odškrtnuto" : "Odškrtnout"}: ${i.label}`}
                    onClick={() => onTick(i)}
                  >
                    <span className="dot" aria-hidden="true">
                      {i.checked ? "✓" : ""}
                    </span>
                  </button>
                  <button className="nm" onClick={() => onOpen(i)}>
                    <span className="nmt">
                      {i.label}
                      {waiting?.[i._id] && (
                        <span className="pend" role="img" aria-label="čeká na uložení">
                          ⏳
                        </span>
                      )}
                    </span>
                    {i.note && <span className={`snote ${noteTone(i.note)}`}>{i.note}</span>}
                    <Badges item={i} />
                  </button>
                  <span className={`amt${i.amount === undefined ? " none" : ""}`}>{itemAmount(i)}</span>
                  {rohlik && !i.checked && !locked && (
                    <a
                      className="rlink"
                      href={rohlikSearchUrl(i.label)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Hledat ${i.label} na Rohlíku`}
                    >
                      🔎 Rohlík
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {plenty.length > 0 && (
        <PlentyBox items={plenty} locked={locked} onOpen={onOpen} onRunningLow={onRunningLow} />
      )}
    </>
  );
}

function Badges({ item }: { item: Item }) {
  if (!item.fresh && !item.optional && !item.pinned && !item.manual) return null;
  return (
    <span className="badges">
      {item.fresh && <span className="bd w">{freshBadge(item.fresh)}</span>}
      {item.pinned && <span className="bd pin">📌 přesunuto ručně</span>}
      {item.manual && <span className="bd man">✋ přidáno ručně</span>}
      {item.optional && <span className="bd">volitelné</span>}
    </span>
  );
}

/** "Add your own item" (#10, #30): a Manual Shopping Item on this trip. */
function AddItem({ tripId, locked }: { tripId: Id<"shoppingTrips">; locked: boolean }) {
  const add = useMutation(api.shopping.addManualItem);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = label.trim();
    if (!text || locked) return;
    setLabel("");
    setError(null);
    add({ tripId, label: text }).catch((err) => {
      setLabel(text);
      setError(shoppingError(errorCode(err), "Položku se nepodařilo přidat."));
    });
  }

  return (
    <form className="additem" onSubmit={submit}>
      <input
        className="finput"
        value={label}
        maxLength={80}
        enterKeyHint="done"
        disabled={locked}
        placeholder={locked ? "Bez připojení" : "Přidat vlastní položku (např. toaletní papír)"}
        aria-label="Vlastní položka"
        onChange={(e) => setLabel(e.target.value)}
      />
      <button className="btn" disabled={locked || !label.trim()}>
        Přidat
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

/**
 * "🏠 Máme dost" (#10, #29): the trip's Plenty items, to check at home.
 * "Dochází" clears the Ingredient's Plenty mark, so it moves up into its
 * Store Section on every trip.
 */
function PlentyBox({
  items,
  locked,
  onOpen,
  onRunningLow,
}: {
  items: Item[];
  locked: boolean;
  onOpen: (item: Item) => void;
  onRunningLow: (item: Item) => void;
}) {
  const [shown, setShown] = useState(true);
  return (
    <div className="plenty">
      <h3>
        <span>🏠 Máme dost · {items.length}</span>
        <button className="mini" aria-expanded={shown} onClick={() => setShown(!shown)}>
          {shown ? "skrýt" : "zobrazit"}
        </button>
      </h3>
      {shown && (
        <>
          <p className="muted small">
            Jen pro kontrolu doma. Když něco dochází, ťukni „Dochází" a přesune se to do seznamu.
          </p>
          <ul className="plist">
            {[...items]
              .sort((a, b) => a.label.localeCompare(b.label, "cs"))
              .map((i) => (
                <li key={i._id}>
                  <button className="nm" onClick={() => onOpen(i)}>
                    {i.label} <small className="muted">{i.amount === undefined ? "" : itemAmount(i)}</small>
                  </button>
                  <button
                    className="mini"
                    disabled={locked}
                    aria-label={locked ? `Dochází: ${i.label} – bez připojení` : undefined}
                    onClick={() => onRunningLow(i)}
                  >
                    Dochází
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Rows ticked or unticked on the other phone flash briefly. Our own ticks
 * (optimistic, then confirmed) are remembered for a while and don't flash.
 */
function useRemoteFlash(data: List | undefined) {
  const prev = useRef<Map<string, boolean> | null>(null);
  const mine = useRef(new Map<string, number>());
  const [flashing, setFlashing] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!data) return;
    const now = Date.now();
    const next = new Map<string, boolean>();
    const changed: string[] = [];
    for (const t of data.trips) {
      for (const i of t.items) {
        next.set(i._id, i.checked);
        const before = prev.current?.get(i._id);
        if (before !== undefined && before !== i.checked && (mine.current.get(i._id) ?? 0) < now) {
          changed.push(i._id);
        }
      }
    }
    prev.current = next;
    if (changed.length === 0) return;
    setFlashing((s) => new Set([...s, ...changed]));
    // Not cleared on the next update, so a quick second change can't leave a row flashing.
    setTimeout(
      () => setFlashing((s) => new Set([...s].filter((id) => !changed.includes(id)))),
      FLASH_MS,
    );
  }, [data]);

  return {
    flashing,
    markMine: (id: string) => mine.current.set(id, Date.now() + 15_000),
  };
}
