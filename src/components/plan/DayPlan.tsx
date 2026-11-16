import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { addDays, today as pragueToday, type CalendarDay } from "@convex/lib/dates";
import { compareSlots, laterSlots, type MainSlot } from "@convex/lib/slots";
import { errorMessage } from "~/lib/format";
import {
  NO_FILTERS,
  PICKER_SHELVES,
  isSearching,
  nearBadge,
  query,
  resultsLabel,
  shelves,
  type Filters,
  type ShelfKey,
} from "~/lib/library";
import {
  MAX_PORTIONS,
  MIN_PORTIONS,
  PICKER_SLOTS,
  SLOTS,
  SLOT_LABEL,
  cookTotal,
  dayLabel,
  dayOfMonth,
  porce,
  slotShort,
  stripDays,
  weekdayShort,
  type Slot,
} from "~/lib/plan";
import {
  FilterBar,
  IngredientSheet,
  NoResults,
  RecipeSheet,
  Shelves,
  TileGrid,
  type LibraryItem,
} from "../recipes/library";
import { Sheet } from "../recipes/ui";

type Plan = FunctionReturnType<typeof api.plan.range>;
type Meal = Plan["meals"][number];
type Leftover = Plan["leftovers"][number];

/** Which sheet is open over the day. */
type Open =
  | { kind: "picker"; date: CalendarDay; slot: Slot; recipeId?: string }
  | { kind: "meal"; mealId: Id<"plannedMeals"> }
  | null;

/** Leftover chips on a Planned Meal card / in its detail sheet (#8). */
const CARD_LATER_SLOTS = 3;
const SHEET_LATER_SLOTS = 6;

/** Ids of optimistic Leftover Portions the server hasn't confirmed yet. */
const TEMP = "tmp-";
const isTemp = (id: string) => id.startsWith(TEMP);

/**
 * Plán, variant C of #8: a day strip, then one day with Oběd, Večeře and
 * Speciality. `day` is the selected day; `planRecipe` opens the picker for
 * "Naplánovat".
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
  const leftovers = plan?.leftovers ?? [];
  const openMeal = open?.kind === "meal" ? meals.find((m) => m._id === open.mealId) : undefined;
  const openMealSheet = (mealId: Id<"plannedMeals">) => setOpen({ kind: "meal", mealId });
  const specials = meals.filter((m) => m.date === day && m.slot === "special");

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
      <DayStrip days={days} day={day} today={today} meals={meals} leftovers={leftovers} onDay={onDay} />
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
          <>
            {SLOTS.map((slot) => (
              <SlotSection
                key={slot}
                slot={slot}
                meals={meals.filter((m) => m.date === day && m.slot === slot)}
                leftovers={leftovers}
                day={day}
                onAdd={() => setOpen({ kind: "picker", date: day, slot })}
                onOpenMeal={openMealSheet}
              />
            ))}
            <div className="slot">
              <h3 className="sec">Speciality</h3>
              {specials.map((m) => (
                <SpecialCard key={m._id} meal={m} onOpen={() => openMealSheet(m._id)} />
              ))}
              <button className="addmore" onClick={() => setOpen({ kind: "picker", date: day, slot: "special" })}>
                + Speciál (oslava)
              </button>
            </div>
          </>
        )}
      </div>

      <button className="fab" onClick={() => setOpen({ kind: "picker", date: day, slot: "lunch" })}>
        + Přidat jídlo
      </button>

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
        <MealSheet
          meal={openMeal}
          leftovers={leftovers.filter((l) => l.source._id === openMeal._id)}
          defaultPortions={plan.defaultPortions}
          onClose={() => close()}
        />
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
  leftovers,
  onDay,
}: {
  days: CalendarDay[];
  day: CalendarDay;
  today: CalendarDay;
  meals: Meal[];
  leftovers: Leftover[];
  onDay: (day: CalendarDay) => void;
}) {
  const filled = useMemo(() => {
    const set = new Set<string>();
    for (const m of meals) set.add(`${m.date}/${m.slot}`);
    for (const l of leftovers) set.add(`${l.date}/${l.slot}`);
    return set;
  }, [meals, leftovers]);
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
            {filled.has(`${d}/special`) && <i className="s" />}
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
  leftovers,
  day,
  onAdd,
  onOpenMeal,
}: {
  slot: MainSlot;
  meals: Meal[];
  /** All loaded Leftover Portions; this slot's and the meals' own are picked out. */
  leftovers: Leftover[];
  day: CalendarDay;
  onAdd: () => void;
  onOpenMeal: (id: Id<"plannedMeals">) => void;
}) {
  const here = leftovers.filter((l) => l.date === day && l.slot === slot);
  const items = [
    ...meals.map((m) => ({ order: m.order, meal: m, leftover: undefined })),
    ...here.map((l) => ({ order: l.order, meal: undefined, leftover: l })),
  ].sort((a, b) => a.order - b.order);
  return (
    <div className="slot">
      <h3 className="sec">{SLOT_LABEL[slot]}</h3>
      {items.map(({ meal, leftover }) =>
        meal ? (
          <MealCard
            key={meal._id}
            meal={meal}
            leftovers={leftovers.filter((l) => l.source._id === meal._id)}
            onOpen={() => onOpenMeal(meal._id)}
          />
        ) : (
          <LeftoverCard key={leftover!._id} leftover={leftover!} onOpenSource={() => onOpenMeal(leftover!.source._id)} />
        ),
      )}
      {items.length === 0 ? (
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

function MealCard({
  meal,
  leftovers,
  onOpen,
}: {
  meal: Meal;
  leftovers: Leftover[];
  onOpen: () => void;
}) {
  return (
    <div className="mcard">
      <button className="nm" onClick={onOpen}>
        {meal.recipe.name || "Recept"} <span aria-hidden="true">›</span>
      </button>
      <div className="line2">
        <span className="muted">Porce</span>
        <MealPortions meal={meal} />
        {leftovers.length > 0 && (
          <span className="cook">uvařit {cookTotal(meal.portions, leftovers)}</span>
        )}
      </div>
      <div className="line2">
        <span className="muted">Uvařit i na:</span>
        <LeftoverChips meal={meal} leftovers={leftovers} count={CARD_LATER_SLOTS} />
      </div>
    </div>
  );
}

function LeftoverCard({ leftover, onOpenSource }: { leftover: Leftover; onOpenSource: () => void }) {
  const remove = useRemoveLeftover();
  const [error, setError] = useState<string | null>(null);
  const { source } = leftover;
  return (
    <div className="mcard left">
      <button className="nm" onClick={onOpenSource}>
        ↩ {source.recipe.name || "Recept"}
      </button>
      <span className="muted small">
        zbytky – uvaří se {dayLabel(source.date)} ({SLOT_LABEL[source.slot].toLowerCase()})
      </span>
      <div className="line2">
        <span className="muted">Porce</span>
        <LeftoverPortions leftover={leftover} />
        <button
          className="qchip"
          disabled={isTemp(leftover._id)}
          onClick={() => {
            setError(null);
            remove({ leftoverId: leftover._id }).catch((err) => setError(errorMessage(err)));
          }}
        >
          Zrušit
        </button>
      </div>
      {error && <span className="error small">{error}</span>}
    </div>
  );
}

function SpecialCard({ meal, onOpen }: { meal: Meal; onOpen: () => void }) {
  return (
    <div className="mcard special">
      <span className="occ">🎉 {meal.occasion || "Speciál"}</span>
      <button className="nm" onClick={onOpen}>
        {meal.recipe.name || "Recept"} <span aria-hidden="true">›</span>
      </button>
      <div className="line2">
        <span className="muted">Porce</span>
        <MealPortions meal={meal} />
      </div>
    </div>
  );
}

// ---------- leftovers ----------

/** "Uvařit i na:" toggle chips for the next `count` Lunch/Dinner slots. */
function LeftoverChips({
  meal,
  leftovers,
  count,
}: {
  meal: Meal;
  leftovers: Leftover[];
  count: number;
}) {
  const add = useMutation(api.plan.addLeftover).withOptimisticUpdate((store, { mealId, date, slot }) =>
    patchPlan(store, (plan) => {
      if (plan.leftovers.some((l) => l.source._id === mealId && l.date === date && l.slot === slot)) {
        return plan;
      }
      const leftover: Leftover = {
        _id: `${TEMP}${mealId}-${date}-${slot}` as Id<"leftoverPortions">,
        date,
        slot,
        order: Number.MAX_SAFE_INTEGER,
        portions: plan.defaultPortions,
        source: {
          _id: meal._id,
          date: meal.date,
          slot: meal.slot as MainSlot,
          recipe: meal.recipe,
        },
      };
      return { ...plan, leftovers: [...plan.leftovers, leftover] };
    }),
  );
  const remove = useRemoveLeftover();
  const [error, setError] = useState<string | null>(null);
  if (meal.slot === "special") return null;
  const targets = laterSlots({ date: meal.date, slot: meal.slot }, count);
  return (
    <>
      {targets.map((t) => {
        const on = leftovers.find((l) => l.date === t.date && l.slot === t.slot);
        return (
          <button
            key={`${t.date}/${t.slot}`}
            className={`qchip${on ? " on" : ""}`}
            aria-pressed={on !== undefined}
            disabled={on !== undefined && isTemp(on._id)}
            onClick={() => {
              setError(null);
              const done = on
                ? remove({ leftoverId: on._id })
                : add({ mealId: meal._id, date: t.date, slot: t.slot });
              done.catch((err) => setError(errorMessage(err)));
            }}
          >
            {on ? "✓ " : ""}
            {slotShort(t.date, t.slot)}
          </button>
        );
      })}
      {error && <span className="error small">{error}</span>}
    </>
  );
}

function useRemoveLeftover() {
  return useMutation(api.plan.removeLeftover).withOptimisticUpdate((store, { leftoverId }) =>
    patchPlan(store, (plan) => ({
      ...plan,
      leftovers: plan.leftovers.filter((l) => l._id !== leftoverId),
    })),
  );
}

// ---------- portions ----------

/** Updates every loaded `plan.range` result before the server answers. */
function patchPlan(store: OptimisticLocalStore, fn: (plan: Plan) => Plan) {
  for (const { args, value } of store.getAllQueries(api.plan.range)) {
    if (value) store.setQuery(api.plan.range, args, fn(value));
  }
}

function patchMeals(store: OptimisticLocalStore, fn: (meals: Meal[]) => Meal[]) {
  patchPlan(store, (plan) => ({ ...plan, meals: fn(plan.meals) }));
}

function MealPortions({ meal }: { meal: Meal }) {
  const setPortions = useMutation(api.plan.setPortions).withOptimisticUpdate(
    (store, { mealId, portions }) =>
      patchMeals(store, (meals) => meals.map((m) => (m._id === mealId ? { ...m, portions } : m))),
  );
  return (
    <Stepper
      value={meal.portions}
      onChange={(portions) => setPortions({ mealId: meal._id, portions })}
    />
  );
}

function LeftoverPortions({ leftover }: { leftover: Leftover }) {
  const setPortions = useMutation(api.plan.setLeftoverPortions).withOptimisticUpdate(
    (store, { leftoverId, portions }) =>
      patchPlan(store, (plan) => ({
        ...plan,
        leftovers: plan.leftovers.map((l) => (l._id === leftoverId ? { ...l, portions } : l)),
      })),
  );
  return (
    <Stepper
      value={leftover.portions}
      disabled={isTemp(leftover._id)}
      onChange={(portions) => setPortions({ leftoverId: leftover._id, portions })}
    />
  );
}

function Stepper({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => Promise<unknown>;
}) {
  const [error, setError] = useState<string | null>(null);
  function change(by: number) {
    const next = value + by;
    if (next < MIN_PORTIONS || next > MAX_PORTIONS) return;
    setError(null);
    onChange(next).catch((err) => setError(errorMessage(err)));
  }
  return (
    <>
      <span className="pstep">
        <button aria-label="Méně porcí" disabled={disabled || value <= MIN_PORTIONS} onClick={() => change(-1)}>
          −
        </button>
        <output aria-live="polite">{value}</output>
        <button aria-label="Více porcí" disabled={disabled || value >= MAX_PORTIONS} onClick={() => change(1)}>
          +
        </button>
      </span>
      {error && <span className="error small">{error}</span>}
    </>
  );
}

// ---------- sheets ----------

/**
 * "Přidat jídlo" (#26, decision #12): pick a day, a slot (and an Occasion),
 * then a Recipe from the library's shelves. The category chip follows the
 * slot until changed. A tile shows an amber badge when the same Recipe is
 * planned or was cooked within four days of the day; nothing is blocked.
 * Tapping a tile opens its detail sheet with "Dát na …".
 */
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
  const [occasion, setOccasion] = useState("");
  /** Unset: follows the slot (Speciál → Speciality, else Hlavní jídla). */
  const [category, setCategory] = useState<Filters["category"] | null>(null);
  const [rest, setRest] = useState<Omit<Filters, "category">>({ text: "", ingredients: [] });
  const [shelf, setShelf] = useState<ShelfKey | null>(null);
  const [ingSheet, setIngSheet] = useState(false);
  const [open, setOpen] = useState<Id<"recipes"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = pragueToday();

  const recipes = useMemo(() => library?.recipes ?? [], [library]);
  const chosen = recipeId ? recipes.find((r) => r._id === recipeId) : undefined;
  // "Naplánovat" on a special Recipe starts on Speciál.
  const chosenSpecial = chosen?.category === "special";
  useEffect(() => {
    if (chosenSpecial) setSlot("special");
  }, [chosenSpecial]);

  const slotCategory = slot === "special" ? "special" : "main";
  const filters: Filters = useMemo(
    () => ({ ...rest, category: category ?? slotCategory }),
    [rest, category, slotCategory],
  );
  const rows = useMemo(() => query(recipes, filters, today), [recipes, filters, today]);
  const searching = isSearching(filters);
  const badgeFor = (r: LibraryItem) => nearBadge(r.mealDates, date, today);
  const onFilters = (patch: Partial<Filters>) => {
    const { category: c, ...others } = patch;
    if (c !== undefined) setCategory(c);
    setRest((f) => ({ ...f, ...others }));
    setShelf(null);
  };
  const resetFilters = () => onFilters({ ...NO_FILTERS, category: slotCategory });
  const target = `${dayLabel(date)} · ${SLOT_LABEL[slot]}`;

  async function place(id: Id<"recipes">) {
    setBusy(true);
    setError(null);
    try {
      await add({ date, slot, recipeId: id, ...(slot === "special" && { occasion }) });
      onPlaced(date);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  let body: React.ReactNode;
  if (library === undefined) {
    body = <p className="muted">Načítám…</p>;
  } else if (recipes.length === 0) {
    body = (
      <p className="muted">
        Zatím nemáš žádné uložené recepty. <Link to="/recepty/vyfotit">Vyfoť první</Link>.
      </p>
    );
  } else if (searching) {
    body = (
      <>
        <div className="count">
          <span>{resultsLabel(rows.length)}</span>
        </div>
        {rows.length ? (
          <TileGrid rows={rows} onOpen={setOpen} badgeFor={badgeFor} />
        ) : (
          <NoResults onReset={resetFilters} />
        )}
      </>
    );
  } else {
    const list = shelves(rows, PICKER_SHELVES);
    const one = shelf && list.find((s) => s.key === shelf);
    if (one) {
      body = (
        <>
          <div className="count">
            <b>{one.title}</b>
            <button type="button" className="chip" onClick={() => setShelf(null)}>
              ‹ Zpět
            </button>
          </div>
          <TileGrid rows={one.rows} onOpen={setOpen} badgeFor={badgeFor} />
        </>
      );
    } else if (list.length === 0) {
      body = <NoResults onReset={resetFilters} />;
    } else {
      body = <Shelves list={list} onShelf={setShelf} onOpen={setOpen} badgeFor={badgeFor} />;
    }
  }

  const occasionField = slot === "special" && (
    <input
      className="finput"
      placeholder="Příležitost, např. Ondra – narozeniny"
      value={occasion}
      maxLength={80}
      onChange={(e) => setOccasion(e.target.value)}
      aria-label="Příležitost"
    />
  );
  const chosenBadge = chosen ? badgeFor(chosen) : null;
  const openRecipe = open ? recipes.find((r) => r._id === open) : undefined;
  const openBadge = openRecipe ? badgeFor(openRecipe) : null;

  return (
    <>
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
        <div className="seg" role="tablist" aria-label="Kam">
          {PICKER_SLOTS.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={slot === s}
              className={slot === s ? "on" : ""}
              onClick={() => setSlot(s)}
            >
              {SLOT_LABEL[s]}
            </button>
          ))}
        </div>
        {occasionField}
        {chosen && (
          <button className="pick chosen" disabled={busy} onClick={() => place(chosen._id)}>
            <b>{chosen.name}</b>
            <span className="muted small">
              Naplánovat sem
              {chosenBadge && (
                <>
                  {" "}
                  · <span className="near">{chosenBadge}</span>
                </>
              )}
            </span>
          </button>
        )}
        {error && !open && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {recipes.length > 0 && (
          <FilterBar
            filters={filters}
            onChange={onFilters}
            onIngredients={() => setIngSheet(true)}
            reset={{ ...NO_FILTERS, category: slotCategory }}
          />
        )}
        {body}
      </Sheet>

      {ingSheet && (
        <IngredientSheet
          recipes={recipes}
          picked={filters.ingredients}
          countFor={(ingredients) => query(recipes, { ...filters, ingredients }, today).length}
          onChange={(ingredients) => onFilters({ ingredients })}
          onClose={() => setIngSheet(false)}
        />
      )}
      {open && (
        <RecipeSheet
          recipeId={open}
          onClose={() => {
            setOpen(null);
            setError(null);
          }}
          planAction={
            <>
              {occasionField}
              {openBadge && <p className="banner warn small">Pozor: {openBadge}</p>}
              <button type="button" className="btn primary" disabled={busy} onClick={() => void place(open)}>
                Dát na {target}
              </button>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </>
          }
        />
      )}
    </>
  );
}

/** Tap a recipe name: Portions, Leftovers or Occasion, and "Odebrat z plánu". */
function MealSheet({
  meal,
  leftovers,
  defaultPortions,
  onClose,
}: {
  meal: Meal;
  leftovers: Leftover[];
  defaultPortions: number;
  onClose: () => void;
}) {
  const remove = useMutation(api.plan.remove).withOptimisticUpdate((store, { mealId }) =>
    patchPlan(store, (plan) => ({
      ...plan,
      meals: plan.meals.filter((m) => m._id !== mealId),
      leftovers: plan.leftovers.filter((l) => l.source._id !== mealId),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const ordered = [...leftovers].sort(compareSlots);
  return (
    <Sheet title={meal.recipe.name || "Recept"} onClose={onClose}>
      <p className="muted">
        {dayLabel(meal.date)} · {SLOT_LABEL[meal.slot]}
      </p>
      {meal.slot === "special" && <OccasionField meal={meal} />}
      <div className="srow">
        <span>
          Porce <span className="muted small">(výchozí {defaultPortions})</span>
        </span>
        <MealPortions meal={meal} />
      </div>
      {meal.slot !== "special" && (
        <>
          <div className="lblock">
            <span>Zbytky – uvařit víc na později</span>
            <div className="line2">
              <LeftoverChips meal={meal} leftovers={leftovers} count={SHEET_LATER_SLOTS} />
            </div>
            {ordered.map((l) => (
              <div key={l._id} className="lrow">
                <span>↩ {slotShort(l.date, l.slot)}</span>
                <LeftoverPortions leftover={l} />
              </div>
            ))}
          </div>
          <p className="total">
            Uvařit celkem <b>{porce(cookTotal(meal.portions, leftovers))}</b> – podle toho se počítá nákup.
          </p>
        </>
      )}
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

/** A Special's Occasion, saved when the field is left (or Enter). */
function OccasionField({ meal }: { meal: Meal }) {
  const setOccasion = useMutation(api.plan.setOccasion).withOptimisticUpdate(
    (store, { mealId, occasion }) =>
      patchMeals(store, (meals) =>
        meals.map((m) => (m._id === mealId ? { ...m, occasion: occasion.trim() || undefined } : m)),
      ),
  );
  const [text, setText] = useState(meal.occasion ?? "");
  const [error, setError] = useState<string | null>(null);
  function save() {
    if (text.trim() === (meal.occasion ?? "")) return;
    setError(null);
    setOccasion({ mealId: meal._id, occasion: text }).catch((err) => setError(errorMessage(err)));
  }
  return (
    <label className="lbl">
      Příležitost
      <input
        className="finput"
        value={text}
        maxLength={80}
        placeholder="např. Ondra – narozeniny"
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      {error && <span className="error small">{error}</span>}
    </label>
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
