import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { TripLock } from "@convex/lib/shopping";
import { Sheet } from "~/components/recipes/ui";
import { dayLabel } from "~/lib/plan";
import { errorCode, shoppingError, TRIP_LOCK_LABEL } from "~/lib/shopping";

type Kind = "store" | "rohlik";

function KindChips({ kind, onChange, disabled }: { kind: Kind; onChange: (k: Kind) => void; disabled?: boolean }) {
  return (
    <div className="chips">
      <button type="button" className={`chip${kind === "store" ? " on" : ""}`} disabled={disabled} onClick={() => onChange("store")}>
        🛒 Obchod
      </button>
      <button type="button" className={`chip rl${kind === "rohlik" ? " on" : ""}`} disabled={disabled} onClick={() => onChange("rohlik")}>
        🚚 Rohlík
      </button>
    </div>
  );
}

/**
 * The "+" tab (#30): a new Shopping Trip on a chosen day. A second trip on a
 * day that already has one only gets manual and moved items (#7).
 */
export function AddTripSheet({
  today,
  takenDays,
  onClose,
  onAdded,
}: {
  today: string;
  takenDays: Set<string>;
  onClose: () => void;
  onAdded: (id: Id<"shoppingTrips">) => void;
}) {
  const addTrip = useMutation(api.shopping.addTrip);
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState<Kind>("store");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      onAdded(await addTrip({ date, kind }));
    } catch (e) {
      setError(shoppingError(errorCode(e), "Nákup se nepodařilo přidat."));
      setBusy(false);
    }
  }

  return (
    <Sheet title="Přidat nákup" onClose={onClose}>
      <label className="lbl">
        Kdy
        <input className="finput" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {takenDays.has(date) && (
        <p className="muted small">
          Ten den už nákup je. Druhý nákup dostane jen položky, které do něj přidáš nebo přesuneš.
        </p>
      )}
      <KindChips kind={kind} onChange={setKind} />
      {kind === "rohlik" && (
        <p className="muted small">Rohlík doveze na večeři v den doručení a na další dny, ne na oběd.</p>
      )}
      <button className="btn primary" onClick={add} disabled={busy || !date || date < today}>
        {busy ? "Přidávám…" : "Přidat nákup"}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </Sheet>
  );
}

/**
 * The trip "⋯" menu (#10, #30): Obchod/Rohlík, move to another day, delete,
 * mark done / reopen. Moving and deleting need nothing ticked on the trip.
 */
export function TripMenuSheet({
  trip,
  today,
  onClose,
}: {
  trip: { _id: Id<"shoppingTrips">; date: string; kind: Kind; status: "planned" | "done"; lock: TripLock | null };
  today: string;
  onClose: () => void;
}) {
  const setKind = useMutation(api.shopping.setTripKind);
  const setStatus = useMutation(api.shopping.setTripStatus);
  const moveTrip = useMutation(api.shopping.moveTrip);
  const deleteTrip = useMutation(api.shopping.deleteTrip);
  const [date, setDate] = useState(trip.date);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, fallback: string, close = false) {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (close) onClose();
    } catch (e) {
      setError(shoppingError(errorCode(e), fallback));
    } finally {
      setBusy(false);
    }
  }

  const done = trip.status === "done";
  return (
    <Sheet title={`Nákup ${dayLabel(trip.date)}`} onClose={onClose}>
      <div>
        <h3 className="isheet-sub">Způsob</h3>
        <KindChips
          kind={trip.kind}
          disabled={busy}
          onChange={(kind) => run(() => setKind({ tripId: trip._id, kind }), "Změna se nepodařila.")}
        />
        {trip.kind === "rohlik" && (
          <p className="muted small">Rohlík doveze na večeři v den doručení a na další dny, ne na oběd.</p>
        )}
      </div>

      <div>
        <h3 className="isheet-sub">Přesunout</h3>
        {trip.lock ? (
          <p className="muted small">{TRIP_LOCK_LABEL[trip.lock]}</p>
        ) : (
          <div className="frow">
            <input
              className="finput grow"
              type="date"
              min={today}
              value={date}
              aria-label="Nové datum"
              onChange={(e) => setDate(e.target.value)}
            />
            <button
              className="btn"
              disabled={busy || !date || date < today || date === trip.date}
              onClick={() => run(() => moveTrip({ tripId: trip._id, date }), "Přesun se nepodařil.", true)}
            >
              Přesunout
            </button>
          </div>
        )}
      </div>

      <button
        className="btn"
        disabled={busy}
        onClick={() =>
          run(
            () => setStatus({ tripId: trip._id, status: done ? "planned" : "done" }),
            "Změna se nepodařila.",
            true,
          )
        }
      >
        {done ? "Znovu otevřít" : "Označit jako hotový"}
      </button>
      {!done && (
        <p className="muted small">Hotový nákup už nedostává nové položky.</p>
      )}

      {!trip.lock &&
        (confirmDelete ? (
          <div className="why gone">
            <p>Smazat nákup {dayLabel(trip.date)}? Položky z jídel se přesunou na jiné nákupy, ručně přidané zmizí.</p>
            <div className="frow">
              <button className="btn" onClick={() => setConfirmDelete(false)} disabled={busy}>
                Ne
              </button>
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => run(() => deleteTrip({ tripId: trip._id }), "Smazání se nepodařilo.", true)}
              >
                Smazat
              </button>
            </div>
          </div>
        ) : (
          <button className="btn danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
            Smazat nákup
          </button>
        ))}
      {error && <p className="error" role="alert">{error}</p>}
    </Sheet>
  );
}
