import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { addDays, today as pragueToday, type CalendarDay } from "@convex/lib/dates";
import { CATEGORY_LABEL, errorMessage } from "~/lib/format";
import {
  MAX_PORTIONS,
  MIN_PORTIONS,
  SLOTS,
  SLOT_LABEL,
  dayLabel,
  dayOfMonth,
  searchKey,
  stripDays,
  weekdayShort,
  type Slot,
} from "~/lib/plan";
import { Sheet } from "../recipes/ui";

type Plan = FunctionReturnType<typeof api.plan.range>;
type Meal = Plan["meals"][number];

/** Which sheet is open over the day. */
type Open =
  | { kind: "picker"; date: CalendarDay; slot: Slot; recipeId?: string }
  | { kind: "meal"; mealId: Id<"plannedMeals"> }
  | null;

/**
 * Plán, variant C of #8: a day strip, then one day with Oběd and Večeře.
 * `day` is the selected day; `planRecipe` opens the picker for "Naplánovat".
 */
export function DayPlan({
  day,
  planRecipe,
  onChange,
}: {
  day: CalendarDay;
  planRecipe?: string;
  /** Move to `day` and/or end the "Naplánovat" flow, in one navigation. */
  onChange: (change: { day?: CalendarDay; planRecipeDone?: boolean }) => void;
}) {
  const onDay = (d: CalendarDay) => onChange({ day: d });
  const today = pragueToday();
  const days = useMemo(() => stripDays(today, day), [today, day]);
  const plan = useStickyQuery(api.plan.range, { from: days[0], to: days[days.length - 1] });
  const [open, setOpen] = useState<Open>(null);
  useEffect(() => {
    if (planRecipe) setOpen({ kind: "picker", date: day, slot: "lunch", recipeId: planRecipe });
    // Only when a new "Naplánovat" arrives, not on every day change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planRecipe]);

  function close(placedOn?: CalendarDay) {
    const planRecipeDone = open?.kind === "picker" && open.recipeId !== undefined;
    if (placedOn || planRecipeDone) onChange({ day: placedOn, planRecipeDone });
    setOpen(null);
  }

  const swipe = useSwipe((dir) => onDay(addDays(day, dir)));
  const meals = plan?.meals ?? [];
  const openMeal = open?.kind === "meal" ? meals.find((m) => m._id === open.mealId) : undefined;

  return (
    <section className="page plan">
      <header className="plan-top">
        <h1>Plán</h1>
        {day !== today && (
          <button className="chip" onClick={() => onDay(today)}>
            Dnes
          </button>
        )}
      </header>
      <DayStrip days={days} day={day} today={today} meals={meals} onDay={onDay} />
      <div className="dhead">
        <button className="navb" aria-label="Předchozí den" onClick={() => onDay(addDays(day, -1))}>
          ‹
        </button>
        <h2>
          {dayLabel(day)}
          {day === today ? " · dnes" : ""}
        </h2>
        <button className="navb" aria-label="Další den" onClick={() => onDay(addDays(day, 1))}>
          ›
        </button>
      </div>

      <div className="dayview" {...swipe}>
        {plan === undefined ? (
          <p className="muted">Načítám…</p>
        ) : (
          SLOTS.map((slot) => (
            <SlotSection
              key={slot}
              slot={slot}
              meals={meals.filter((m) => m.date === day && m.slot === slot)}
              onAdd={() => setOpen({ kind: "picker", date: day, slot })}
              onOpenMeal={(mealId) => setOpen({ kind: "meal", mealId })}
            />
          ))
        )}
      </div>

      {open?.kind === "picker" && (
        <PickerSheet
          initialDate={open.date}
          initialSlot={open.slot}
          recipeId={open.recipeId}
          onClose={() => close()}
          onPlaced={(date) => close(date)}
        />
      )}
      {open?.kind === "meal" && openMeal && plan && (
        <MealSheet meal={openMeal} defaultPortions={plan.defaultPortions} onClose={() => close()} />
      )}
    </section>
  );
}

// ---------- day strip ----------

function DayStrip({
  days,
  day,
  today,
  meals,
  onDay,
}: {
  days: CalendarDay[];
  day: CalendarDay;
  today: CalendarDay;
  meals: Meal[];
  onDay: (day: CalendarDay) => void;
}) {
  const filled = useMemo(() => {
    const set = new Set<string>();
    for (const m of meals) set.add(`${m.date}/${m.slot}`);
    return set;
  }, [meals]);
  const selected = useRef<HTMLButtonElement>(null);
  const first = useRef(true);
  useEffect(() => {
    const behavior = first.current ? "instant" : "smooth";
    first.current = false;
    selected.current?.scrollIntoView({ block: "nearest", inline: "center", behavior });
  }, [day]);
  return (
    <div className="strip" role="tablist" aria-label="Dny">
      {days.map((d) => (
        <button
          key={d}
          ref={d === day ? selected : undefined}
          role="tab"
          aria-selected={d === day}
          className={`dchip${d === day ? " on" : ""}${d === today ? " today" : ""}`}
          onClick={() => onDay(d)}
        >
          {weekdayShort(d)}
          <b>{dayOfMonth(d)}</b>
          <span className="dots" aria-hidden="true">
            {SLOTS.map((s) => (
              <i key={s} className={filled.has(`${d}/${s}`) ? "f" : ""} />
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------- slots and cards ----------

function SlotSection({
  slot,
  meals,
  onAdd,
  onOpenMeal,
}: {
  slot: Slot;
  meals: Meal[];
  onAdd: () => void;
  onOpenMeal: (id: Id<"plannedMeals">) => void;
}) {
  return (
    <div className="slot">
      <h3 className="sec">{SLOT_LABEL[slot]}</h3>
      {meals.map((m) => (
        <MealCard key={m._id} meal={m} onOpen={() => onOpenMeal(m._id)} />
      ))}
      {meals.length === 0 ? (
        <button className="mcard empty" onClick={onAdd}>
          Zatím nic · <b>+ Přidat</b>
        </button>
      ) : (
        <button className="addmore" onClick={onAdd}>
          + Přidat další
        </button>
      )}
    </div>
  );
}

function MealCard({ meal, onOpen }: { meal: Meal; onOpen: () => void }) {
  return (
    <div className="mcard">
      <button className="nm" onClick={onOpen}>
        {meal.recipe.name || "Recept"} <span aria-hidden="true">›</span>
      </button>
      <div className="line2">
        <span className="muted">Porce</span>
        <PortionsStepper meal={meal} />
      </div>
    </div>
  );
}

/** Updates every loaded `plan.range` result before the server answers. */
function patchMeals(store: OptimisticLocalStore, fn: (meals: Meal[]) => Meal[]) {
  for (const { args, value } of store.getAllQueries(api.plan.range)) {
    if (value) store.setQuery(api.plan.range, args, { ...value, meals: fn(value.meals) });
  }
}

function PortionsStepper({ meal }: { meal: Meal }) {
  const setPortions = useMutation(api.plan.setPortions).withOptimisticUpdate(
    (store, { mealId, portions }) =>
      patchMeals(store, (meals) => meals.map((m) => (m._id === mealId ? { ...m, portions } : m))),
  );
  const [error, setError] = useState<string | null>(null);
  function change(by: number) {
    const portions = meal.portions + by;
    if (portions < MIN_PORTIONS || portions > MAX_PORTIONS) return;
    setError(null);
    setPortions({ mealId: meal._id, portions }).catch((err) => setError(errorMessage(err)));
  }
  return (
    <>
      <span className="pstep">
        <button aria-label="Méně porcí" disabled={meal.portions <= MIN_PORTIONS} onClick={() => change(-1)}>
          −
        </button>
        <output aria-live="polite">{meal.portions}</output>
        <button aria-label="Více porcí" disabled={meal.portions >= MAX_PORTIONS} onClick={() => change(1)}>
          +
        </button>
      </span>
      {error && <span className="error small">{error}</span>}
    </>
  );
}

// ---------- sheets ----------

/** "Přidat jídlo": pick a day, a slot and a confirmed Recipe; tap places it. */
function PickerSheet({
  initialDate,
  initialSlot,
  recipeId,
  onClose,
  onPlaced,
}: {
  initialDate: CalendarDay;
  initialSlot: Slot;
  recipeId?: string;
  onClose: () => void;
  onPlaced: (date: CalendarDay) => void;
}) {
  const library = useQuery(api.recipes.library);
  const add = useMutation(api.plan.add);
  const [date, setDate] = useState(initialDate);
  const [slot, setSlot] = useState<Slot>(initialSlot);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recipes = library?.recipes ?? [];
  const chosen = recipeId ? recipes.find((r) => r._id === recipeId) : undefined;
  const q = searchKey(search);
  const list = recipes.filter((r) => r._id !== chosen?._id && searchKey(r.name).includes(q));

  async function place(id: Id<"recipes">) {
    setBusy(true);
    setError(null);
    try {
      await add({ date, slot, recipeId: id });
      onPlaced(date);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const row = (r: (typeof recipes)[number], mark?: boolean) => (
    <button key={r._id} className={`pick${mark ? " chosen" : ""}`} disabled={busy} onClick={() => place(r._id)}>
      <b>{r.name}</b>
      <span className="muted small">{mark ? "Naplánovat sem" : CATEGORY_LABEL[r.category]}</span>
    </button>
  );

  return (
    <Sheet title="Přidat jídlo" onClose={onClose}>
      <div className="pday">
        <button className="navb" aria-label="Předchozí den" onClick={() => setDate(addDays(date, -1))}>
          ‹
        </button>
        <span>{dayLabel(date)}</span>
        <button className="navb" aria-label="Další den" onClick={() => setDate(addDays(date, 1))}>
          ›
        </button>
      </div>
      <div className="seg" role="tablist">
        {SLOTS.map((s) => (
          <button key={s} role="tab" aria-selected={slot === s} className={slot === s ? "on" : ""} onClick={() => setSlot(s)}>
            {SLOT_LABEL[s]}
          </button>
        ))}
      </div>
      {chosen && row(chosen, true)}
      <input
        className="finput"
        type="search"
        placeholder="Hledat recept…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Hledat recept"
      />
      {error && <p className="error" role="alert">{error}</p>}
      {library === undefined ? (
        <p className="muted">Načítám…</p>
      ) : recipes.length === 0 ? (
        <p className="muted">
          Zatím nemáš žádné uložené recepty. <Link to="/recepty/vyfotit">Vyfoť první</Link>.
        </p>
      ) : list.length === 0 ? (
        !chosen && <p className="muted">Nic nenalezeno.</p>
      ) : (
        <div className="picklist">{list.map((r) => row(r))}</div>
      )}
    </Sheet>
  );
}

/** Tap a recipe name: Portions and "Odebrat z plánu". */
function MealSheet({
  meal,
  defaultPortions,
  onClose,
}: {
  meal: Meal;
  defaultPortions: number;
  onClose: () => void;
}) {
  const remove = useMutation(api.plan.remove).withOptimisticUpdate((store, { mealId }) =>
    patchMeals(store, (meals) => meals.filter((m) => m._id !== mealId)),
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title={meal.recipe.name || "Recept"} onClose={onClose}>
      <p className="muted">
        {dayLabel(meal.date)} · {SLOT_LABEL[meal.slot as Slot]}
      </p>
      <div className="srow">
        <span>
          Porce <span className="muted small">(výchozí {defaultPortions})</span>
        </span>
        <PortionsStepper meal={meal} />
      </div>
      <Link to="/recepty/$recipeId" params={{ recipeId: meal.recipe._id }} className="btn">
        Otevřít recept
      </Link>
      <button
        className="btn danger"
        onClick={() => {
          setError(null);
          remove({ mealId: meal._id }).then(onClose, (err) => setError(errorMessage(err)));
        }}
      >
        Odebrat z plánu
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </Sheet>
  );
}

// ---------- hooks ----------

/**
 * `useQuery`, but keeps showing the previous result while new args load, so
 * the strip and day don't blank out when the window moves.
 */
function useStickyQuery(query: typeof api.plan.range, args: { from: string; to: string }) {
  const value = useQuery(query, args);
  const last = useRef<Plan | undefined>(undefined);
  if (value !== undefined) last.current = value;
  return value ?? last.current;
}

/** Horizontal swipe on the day: left = next day, right = previous. */
function useSwipe(onStep: (dir: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
    },
    onTouchEnd(e: TouchEvent) {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) > 70 && Math.abs(dx) > 1.5 * Math.abs(dy)) onStep(dx < 0 ? 1 : -1);
    },
  };
}
