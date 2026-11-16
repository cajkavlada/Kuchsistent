import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState } from "react";
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
  splitPlenty,
} from "~/lib/shopping";
import { ItemSheet } from "./ItemSheet";

type List = FunctionReturnType<typeof api.shopping.list>;
type Trip = List["trips"][number];
type Item = Trip["items"][number];

/** How long a row flashes after the other phone ticks it. */
const FLASH_MS = 1600;

/**
 * Nákup, variant A of #10: trip tabs, then one Shopping Trip grouped by
 * Store Section, with Plenty items in a "Máme dost" box at the bottom (#29).
 * Ticks are optimistic and live for both Members. Tapping the circle ticks;
 * tapping the name opens the item sheet.
 */
export function ShoppingList() {
  const data = useQuery(api.shopping.list, {});
  const refresh = useMutation(api.shopping.refresh);
  useEffect(() => {
    // Brings the list up to date when opened (e.g. after midnight).
    refresh({}).catch(() => {});
  }, [refresh]);

  const setChecked = useMutation(api.shopping.setChecked).withOptimisticUpdate(
    (store, { itemId, checked }) => {
      const cur = store.getQuery(api.shopping.list, {});
      if (!cur) return;
      store.setQuery(api.shopping.list, {}, {
        ...cur,
        trips: cur.trips.map((t) => ({
          ...t,
          items: t.items.map((i) => (i._id === itemId ? { ...i, checked } : i)),
        })),
      });
    },
  );

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

  const { flashing, markMine } = useRemoteFlash(data);
  const [selected, setSelected] = useState<Id<"shoppingTrips"> | null>(null);
  const [open, setOpen] = useState<Id<"shoppingItems"> | null>(null);

  if (data === undefined) {
    return (
      <section className="page">
        <h1>Nákup</h1>
        <p className="muted">Načítám…</p>
      </section>
    );
  }
  if (data.trips.length === 0) {
    return (
      <section className="page">
        <h1>Nákup</h1>
        <div className="card center-text">
          <p className="muted">Zatím není co nakoupit.</p>
          <p className="muted small">
            Naplánuj jídla a nákupní seznam se z nich vytvoří sám.
          </p>
          <Link to="/plan" className="btn primary">
            Otevřít plán
          </Link>
        </div>
      </section>
    );
  }

  const trip =
    data.trips.find((t) => t._id === selected) ??
    data.trips.find((t) => t.date >= data.today) ??
    data.trips[0];

  function tick(item: Item) {
    markMine(item._id);
    setChecked({ itemId: item._id, checked: !item.checked }).catch(() => {});
  }
  function plenty(ingredientId: Id<"ingredients">, value: boolean) {
    setPlenty({ ingredientId, plenty: value }).catch(() => {});
  }

  return (
    <section className="page shop">
      <h1>Nákup</h1>
      <TripTabs trips={data.trips} current={trip._id} onSelect={setSelected} />
      <TripView
        trip={trip}
        today={data.today}
        flashing={flashing}
        onTick={tick}
        onOpen={(i) => setOpen(i._id)}
        onRunningLow={(i) => i.ingredient && plenty(i.ingredient, false)}
      />
      {open && <ItemSheet itemId={open} onClose={() => setOpen(null)} onPlenty={plenty} />}
    </section>
  );
}

function TripTabs({
  trips,
  current,
  onSelect,
}: {
  trips: Trip[];
  current: Id<"shoppingTrips">;
  onSelect: (id: Id<"shoppingTrips">) => void;
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
    </div>
  );
}

function TripView({
  trip,
  today,
  flashing,
  onTick,
  onOpen,
  onRunningLow,
}: {
  trip: Trip;
  today: string;
  flashing: Set<string>;
  onTick: (item: Item) => void;
  onOpen: (item: Item) => void;
  onRunningLow: (item: Item) => void;
}) {
  const { list, plenty } = splitPlenty(trip.items);
  const p = progress(list);
  const warnings = freshCount(list);
  const groups = groupBySection(list);
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
      </div>
      <div className="pbar" aria-hidden="true">
        <i style={{ width: `${p.total ? (100 * p.done) / p.total : 0}%` }} />
      </div>
      <p className="muted small">
        {p.done} z {p.total} odškrtnuto
        {warnings > 0 && <span className="warn-text"> · ⚠ {warnings} nebude čerstvé</span>}
      </p>
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
                    <span className="nmt">{i.label}</span>
                    {i.note && <span className={`snote ${noteTone(i.note)}`}>{i.note}</span>}
                    <Badges item={i} />
                  </button>
                  <span className={`amt${i.amount === undefined ? " none" : ""}`}>{itemAmount(i)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {plenty.length > 0 && <PlentyBox items={plenty} onOpen={onOpen} onRunningLow={onRunningLow} />}
    </>
  );
}

function Badges({ item }: { item: Item }) {
  if (!item.fresh && !item.optional) return null;
  return (
    <span className="badges">
      {item.fresh && <span className="bd w">{freshBadge(item.fresh)}</span>}
      {item.optional && <span className="bd">volitelné</span>}
    </span>
  );
}

/**
 * "🏠 Máme dost" (#10, #29): the trip's Plenty items, to check at home.
 * "Dochází" clears the Ingredient's Plenty mark, so it moves up into its
 * Store Section on every trip.
 */
function PlentyBox({
  items,
  onOpen,
  onRunningLow,
}: {
  items: Item[];
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
                  <button className="mini" onClick={() => onRunningLow(i)}>
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
