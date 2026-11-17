import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";
import { invitePath } from "@convex/lib/inviteCode";
import { APP_TIME_ZONE } from "@convex/lib/dates";
import { rememberMember } from "~/pwa";
import { clearOfflineData, pendingTickCount } from "~/offline";
import { signOutQuestion } from "~/lib/offline";
import { FreshnessCard } from "~/components/settings/Freshness";
import { MAX_TRIP_INTERVAL_DAYS, MIN_TRIP_INTERVAL_DAYS } from "@convex/lib/shopping";
import { everyDays } from "~/lib/shopping";

export const Route = createFileRoute("/nastaveni/")({ component: Settings });

function Settings() {
  const { signOut } = useAuthActions();
  return (
    <section className="page">
      <h1>Nastavení</h1>
      <Members />
      <InviteCard />
      <DefaultPortions />
      <TripInterval />
      <IngredientsCard />
      <FreshnessCard />
      <button
        className="btn"
        onClick={() => {
          // Unsent ticks (#13) are lost with the saved copy: ask first.
          const pending = pendingTickCount();
          if (pending > 0 && !window.confirm(signOutQuestion(pending))) return;
          clearOfflineData();
          rememberMember(false);
          void signOut();
        }}
      >
        Odhlásit se
      </button>
    </section>
  );
}

function IngredientsCard() {
  const items = useQuery(api.ingredients.catalogue);
  return (
    <Link to="/nastaveni/suroviny" className="card linkcard">
      <span className="grow">
        <h2>Suroviny{items ? ` (${items.length})` : ""}</h2>
        <span className="muted small">
          Přejmenovat, změnit čerstvost nebo oddělení, sloučit duplicity, nikdy nekupovat.
        </span>
      </span>
      <span aria-hidden="true" className="chev">›</span>
    </Link>
  );
}

function Members() {
  const members = useQuery(api.households.members);
  return (
    <div className="card">
      <h2>Členové</h2>
      {members === undefined ? (
        <p className="muted">Načítám…</p>
      ) : (
        <ul className="members">
          {members.map((m) => (
            <li key={m._id}>
              <Avatar name={m.name} image={m.image} />
              <span>
                {m.name}
                {m.isMe && <span className="muted"> (ty)</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Avatar({ name, image }: { name: string; image: string | null }) {
  const [failed, setFailed] = useState(false);
  if (image && !failed) {
    return (
      <img
        className="avatar"
        src={image}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="avatar" aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

const expiryFormat = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: APP_TIME_ZONE,
  day: "numeric",
  month: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function InviteCard() {
  const create = useMutation(api.invites.create);
  const [invite, setInvite] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  const link = invite ? window.location.origin + invitePath(invite.code) : "";
  const canShare = typeof navigator.share === "function";

  async function onCreate() {
    setBusy(true);
    setError(null);
    try {
      setInvite(await create({}));
      setCopied(null);
    } catch {
      setError("Pozvánku se nepodařilo vytvořit, zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(what: "link" | "code") {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(what === "link" ? link : invite.code);
      setCopied(what);
    } catch {
      setError("Kopírování se nepodařilo, opiš kód ručně.");
    }
  }

  async function share() {
    if (!invite) return;
    try {
      await navigator.share({
        title: "Pozvánka do Kuchsistentu",
        text: `Připoj se k naší domácnosti v Kuchsistentu. Kód: ${invite.code}`,
        url: link,
      });
    } catch {
      // Share sheet dismissed.
    }
  }

  return (
    <div className="card">
      <h2>Pozvat do domácnosti</h2>
      {invite === null ? (
        <>
          <p className="muted small">
            Vytvoř pozvánku pro dalšího člena. Platí 7 dní a jde použít jen jednou.
          </p>
          <button className="btn primary" onClick={onCreate} disabled={busy}>
            {busy ? "Vytvářím…" : "Pozvat do domácnosti"}
          </button>
        </>
      ) : (
        <>
          <p className="invite-code" aria-label="Kód pozvánky">{invite.code}</p>
          <p className="invite-link small">{link}</p>
          <p className="muted small">
            Jednorázová, platí do {expiryFormat.format(invite.expiresAt)}.
          </p>
          {canShare && (
            <button className="btn primary" onClick={share}>Sdílet pozvánku</button>
          )}
          <div className="row">
            <button className="btn" onClick={() => copy("link")}>
              {copied === "link" ? "Odkaz zkopírován ✓" : "Kopírovat odkaz"}
            </button>
            <button className="btn" onClick={() => copy("code")}>
              {copied === "code" ? "Kód zkopírován ✓" : "Kopírovat kód"}
            </button>
          </div>
          <button className="link" onClick={onCreate} disabled={busy}>
            Vytvořit novou pozvánku
          </button>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

function DefaultPortions() {
  const household = useQuery(api.households.current);
  const setDefaultPortions = useMutation(api.households.setDefaultPortions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(by: number) {
    if (!household) return;
    setBusy(true);
    setError(null);
    try {
      await setDefaultPortions({ defaultPortions: household.defaultPortions + by });
    } catch {
      setError("Počet porcí se nepodařilo uložit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Výchozí počet porcí</h2>
      <p className="muted small">Kolik porcí se předvyplní u nového jídla.</p>
      {household && (
        <span className="stepper">
          <button
            type="button"
            aria-label="Méně porcí"
            disabled={busy || household.defaultPortions <= 1}
            onClick={() => change(-1)}
          >
            −
          </button>
          <output aria-live="polite">{household.defaultPortions}</output>
          <button
            type="button"
            aria-label="Více porcí"
            disabled={busy || household.defaultPortions >= 20}
            onClick={() => change(1)}
          >
            +
          </button>
        </span>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/** "Jak často nakupovat" (#7, #30): days between default Shopping Trips. */
function TripInterval() {
  const household = useQuery(api.households.current);
  const setTripInterval = useMutation(api.households.setTripInterval);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(by: number) {
    if (!household) return;
    setBusy(true);
    setError(null);
    try {
      await setTripInterval({ days: household.tripIntervalDays + by });
    } catch {
      setError("Nepodařilo se uložit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Jak často nakupovat</h2>
      <p className="muted small">
        {household ? `Nový nákup se vytvoří ${everyDays(household.tripIntervalDays)}. ` : ""}
        Změna platí jen pro nákupy vytvořené odteď; ty stávající zůstanou, jak jsou.
      </p>
      {household && (
        <span className="stepper">
          <button
            type="button"
            aria-label="Častěji"
            disabled={busy || household.tripIntervalDays <= MIN_TRIP_INTERVAL_DAYS}
            onClick={() => change(-1)}
          >
            −
          </button>
          <output aria-live="polite">{household.tripIntervalDays}</output>
          <button
            type="button"
            aria-label="Méně často"
            disabled={busy || household.tripIntervalDays >= MAX_TRIP_INTERVAL_DAYS}
            onClick={() => change(1)}
          >
            +
          </button>
        </span>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
