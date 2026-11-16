import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { MAX_FRESHNESS_DAYS, MIN_FRESHNESS_DAYS, daysLabel } from "@convex/lib/ingredients";
import { errorMessage } from "~/lib/format";
import { Sheet } from "~/components/recipes/ui";

type Row = FunctionReturnType<typeof api.households.current>["freshness"][number];

/**
 * "Čerstvost" in settings (#22): the five Freshness Classes with this
 * Household's day limits (max days bought before the meal); tap one to change.
 */
export function FreshnessCard() {
  const household = useQuery(api.households.current);
  const [open, setOpen] = useState<Row | null>(null);
  return (
    <div className="card">
      <h2>Čerstvost</h2>
      <p className="muted small">Kolik dní před jídlem se smí surovina nejdřív koupit.</p>
      {household === undefined ? (
        <p className="muted">Načítám…</p>
      ) : (
        <div>
          {household.freshness.map((f) => (
            <button key={f.id} className="sumline fresh" onClick={() => setOpen(f)}>
              <b>{f.label}</b>
              <span>
                {daysLabel(f.days)}
                {f.days !== f.defaultDays && <span className="badge b-new">upraveno</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {open && <DaysSheet key={open.id} row={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function DaysSheet({ row, onClose }: { row: Row; onClose: () => void }) {
  const save = useMutation(api.households.setFreshnessDays);
  const [days, setDays] = useState<number | null>(row.days);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = days ?? row.defaultDays ?? 7;

  async function submit(value: number | null) {
    setBusy(true);
    setError(null);
    try {
      await save({ freshnessClass: row.id, days: value });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Sheet title={row.label} onClose={onClose}>
      <p className="muted small">Nejvýš kolik dní před jídlem se smí koupit.</p>
      <label className="check">
        <input
          type="checkbox"
          checked={days === null}
          onChange={(e) => setDays(e.target.checked ? null : shown)}
        />
        Bez limitu (vydrží libovolně dlouho)
      </label>
      {days !== null && (
        <span className="stepper">
          <button
            type="button"
            aria-label="Méně dní"
            disabled={busy || days <= MIN_FRESHNESS_DAYS}
            onClick={() => setDays(days - 1)}
          >
            −
          </button>
          <output aria-live="polite">{days}</output>
          <button
            type="button"
            aria-label="Více dní"
            disabled={busy || days >= MAX_FRESHNESS_DAYS}
            onClick={() => setDays(days + 1)}
          >
            +
          </button>
        </span>
      )}
      <p className="muted small center-text">
        {daysLabel(days)} · výchozí {daysLabel(row.defaultDays)}
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button className="btn" onClick={onClose} disabled={busy}>
          Zrušit
        </button>
        <button className="btn primary" onClick={() => void submit(days)} disabled={busy}>
          {busy ? "Ukládám…" : "Uložit"}
        </button>
      </div>
      {row.days !== row.defaultDays && (
        <button className="link" onClick={() => void submit(row.defaultDays)} disabled={busy}>
          Vrátit výchozí ({daysLabel(row.defaultDays)})
        </button>
      )}
    </Sheet>
  );
}
