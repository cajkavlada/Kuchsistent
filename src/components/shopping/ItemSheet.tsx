import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { daysLabel, freshnessLabel, sectionLabel } from "@convex/lib/ingredients";
import { Sheet } from "~/components/recipes/ui";
import { dayLabel, SLOT_LABEL } from "~/lib/plan";
import { rohlikSearchUrl } from "~/lib/rohlik";
import {
  errorCode,
  freshExplanation,
  itemAmount,
  MOVE_BLOCK_LABEL,
  noteTone,
  shoppingError,
} from "~/lib/shopping";

/**
 * The item sheet (#10, #29), opened by tapping an item's name: amount, Store
 * Section, Freshness Class and trip; why it's flagged; "Proč to kupuju" (the
 * Planned Meals behind it); "Nakoupit při nákupu" trip chips to move it
 * (#30); "🔎 Hledat na Rohlíku" on a Rohlík trip (#31); the Plenty toggle; and "Smazat" for a Manual Shopping Item or an
 * item no meal needs any more.
 */
export function ItemSheet({
  itemId,
  onClose,
  onPlenty,
}: {
  itemId: Id<"shoppingItems">;
  onClose: () => void;
  onPlenty: (ingredientId: Id<"ingredients">, plenty: boolean) => void;
}) {
  const item = useQuery(api.shopping.item, { itemId });
  const removeItem = useMutation(api.shopping.removeItem);
  const moveItem = useMutation(api.shopping.moveItem);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (item === undefined) {
    return (
      <Sheet title="Položka" onClose={onClose}>
        <p className="muted">Načítám…</p>
      </Sheet>
    );
  }
  if (item === null) {
    return (
      <Sheet title="Položka" onClose={onClose}>
        <p className="muted">Tahle položka už na seznamu není.</p>
        <button className="btn" onClick={onClose}>
          Zavřít
        </button>
      </Sheet>
    );
  }

  const ing = item.ingredient;
  const amount = itemAmount(item);

  async function remove() {
    setError(null);
    try {
      await removeItem({ itemId });
      onClose();
    } catch (e) {
      const code = errorCode(e);
      setError(shoppingError(code, "Smazání se nepovedlo."));
    }
  }

  async function move(tripId: Id<"shoppingTrips">) {
    setError(null);
    setMoving(true);
    try {
      await moveItem({ itemId, tripId });
    } catch (e) {
      setError(shoppingError(errorCode(e), "Přesun se nepovedl."));
    } finally {
      setMoving(false);
    }
  }

  return (
    <Sheet title={item.label} onClose={onClose} hideTitle>
      <div className="isheet-head">
        <h2>{item.label}</h2>
        <span className={`amt${item.amount === undefined ? " none" : ""}`}>{amount}</span>
      </div>
      <p className="muted small">
        {ing
          ? `${sectionLabel(ing.storeSection)} · ${freshnessLabel(ing.freshnessClass)} (${daysLabel(ing.freshnessDays)})`
          : sectionLabel("other")}
        {" · "}
        {item.trip.kind === "rohlik" ? "🚚" : "🛒"} nákup {dayLabel(item.trip.date)}
      </p>
      {(item.optional || item.checked || item.pinned || item.manual) && (
        <div className="badges">
          {item.checked && <span className="bd">✓ odškrtnuto</span>}
          {item.pinned && <span className="bd pin">📌 přesunuto ručně</span>}
          {item.manual && <span className="bd man">✋ přidáno ručně</span>}
          {item.optional && <span className="bd">volitelné</span>}
        </div>
      )}

      {item.fresh && ing && (
        <div className="why warn">⚠ {freshExplanation(item.fresh, freshnessLabel(ing.freshnessClass))}</div>
      )}
      {item.notNeeded && (
        <div className="why gone">
          Jídlo, pro které jsi to koupil, už není v plánu (nebo už tuhle surovinu nepotřebuje). Položka
          zůstává, protože je odškrtnutá. Pokud ji nechceš, smaž ji.
        </div>
      )}
      {item.note && !item.notNeeded && noteTone(item.note) === "gone" && (
        <div className="why gone">
          {item.note} – po změně v plánu je koupeno víc, než je potřeba. Zbytek zůstane doma.
        </div>
      )}
      {item.note && noteTone(item.note) === "delta" && <div className="why delta">{item.note}</div>}
      {item.optional && (
        <p className="muted small">Recept to uvádí jako volitelné („případně", „na ozdobu").</p>
      )}

      {item.sources.length > 0 && (
        <div>
          <h3 className="isheet-sub">Proč to kupuju</h3>
          <ul className="why-list">
            {item.sources.map((m) => (
              <li key={m._id}>
                🍽 <b>{m.recipeName}</b> – {dayLabel(m.date)} {SLOT_LABEL[m.slot].toLowerCase()} ·{" "}
                {m.portions} {portionsWord(m.portions)}
                {m.leftoverPortions > 0 ? ` + ${m.leftoverPortions} na zbytky` : ""}
                {m.occasion ? ` · ${m.occasion}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {item.targets.length > 1 && (
        <div>
          <h3 className="isheet-sub">Nakoupit při nákupu</h3>
          <div className="chips">
            {item.targets.map((t) => (
              <button
                key={t._id}
                className={`chip${t.current ? " on" : ""}`}
                aria-pressed={t.current}
                disabled={moving || t.block !== null}
                onClick={() => !t.current && void move(t._id)}
              >
                {dayLabel(t.date)} {t.kind === "rohlik" ? "🚚" : "🛒"}
                {t.block && ` · ${MOVE_BLOCK_LABEL[t.block]}`}
              </button>
            ))}
          </div>
          {!item.manual && (
            <p className="muted small">
              {item.pinned
                ? "Přesunuto ručně: zůstane tady i po změnách v plánu, dokud tenhle nákup stihne jídlo."
                : "Přesunutá položka zůstane na vybraném nákupu i po změnách v plánu."}
            </p>
          )}
        </div>
      )}

      {item.trip.kind === "rohlik" && (
        <a className="btn rl" href={rohlikSearchUrl(item.label)} target="_blank" rel="noopener noreferrer">
          🔎 Hledat na Rohlíku
        </a>
      )}

      {ing && (
        <label className="check plenty-toggle">
          <input
            type="checkbox"
            checked={ing.plenty}
            onChange={(e) => onPlenty(ing._id, e.target.checked)}
          />
          <span>
            🏠 Máme dost doma
            <br />
            <small className="muted">platí pro „{ing.name}" ve všech nákupech</small>
          </span>
        </label>
      )}

      {(item.notNeeded || item.manual) && (
        <button className="btn danger" onClick={remove}>
          Smazat
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </Sheet>
  );
}

function portionsWord(n: number): string {
  return n >= 1 && n <= 4 ? "porce" : "porcí";
}
