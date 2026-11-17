import { useState } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";
import { normalizeInviteCode } from "@convex/lib/inviteCode";
import { inviteErrorMessage } from "~/lib/invite";
import { clearOfflineData } from "~/offline";

type Step = "choose" | "create" | "invite";

/** First sign-in without a membership (#11). */
export function Onboarding({ mayCreate }: { mayCreate: boolean }) {
  const [step, setStep] = useState<Step>("choose");
  const { signOut } = useAuthActions();

  return (
    <main className="center">
      <p className="logo">🍲 Kuchsistent</p>
      {step === "choose" && (
        <>
          <p className="muted">Zatím nejsi v žádné domácnosti.</p>
          <button className="btn primary" onClick={() => setStep("create")}>
            Založit domácnost
          </button>
          <button className="btn" onClick={() => setStep("invite")}>
            Mám pozvánku
          </button>
        </>
      )}
      {step === "create" &&
        (mayCreate ? (
          <CreateHousehold onBack={() => setStep("choose")} />
        ) : (
          <NoInvite onBack={() => setStep("choose")} />
        ))}
      {step === "invite" && <RedeemCode onBack={() => setStep("choose")} />}
      <button
        className="link"
        onClick={() => {
          clearOfflineData();
          void signOut();
        }}
      >
        Odhlásit se
      </button>
    </main>
  );
}

function NoInvite({ onBack }: { onBack: () => void }) {
  return (
    <>
      <h1>Nemáte pozvánku</h1>
      <p className="muted">
        Domácnost může založit jen pozvaný účet. Požádej člena domácnosti o
        pozvánku.
      </p>
      <button className="btn" onClick={onBack}>Zpět</button>
    </>
  );
}

function CreateHousehold({ onBack }: { onBack: () => void }) {
  const create = useMutation(api.households.create);
  const [portions, setPortions] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await create({ defaultPortions: portions });
      // `me` re-runs reactively and the Gate switches to the app.
    } catch (err) {
      const code = err instanceof ConvexError ? err.data?.code : null;
      setError(
        code === "NOT_ALLOWED_TO_CREATE"
          ? "Nemáte pozvánku"
          : "Domácnost se nepodařilo založit, zkus to znovu.",
      );
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h1>Založit domácnost</h1>
      <label className="field">
        <span>Kolik porcí běžně vaříte?</span>
        <span className="stepper">
          <button type="button" aria-label="Méně porcí" onClick={() => setPortions((p) => Math.max(1, p - 1))}>−</button>
          <output aria-live="polite">{portions}</output>
          <button type="button" aria-label="Více porcí" onClick={() => setPortions((p) => Math.min(20, p + 1))}>+</button>
        </span>
      </label>
      <p className="muted small">Dá se kdykoli změnit v nastavení.</p>
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? "Zakládám…" : "Založit domácnost"}
      </button>
      <button className="btn" type="button" onClick={onBack} disabled={busy}>Zpět</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

/** "Mám pozvánku": type the short code (or paste the whole link). */
function RedeemCode({ onBack }: { onBack: () => void }) {
  const redeem = useMutation(api.invites.redeem);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeInviteCode(code);
    if (normalized === null) {
      setError("Kód má 6 znaků, například K7M-2QX.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await redeem({ code: normalized });
      // `me` re-runs reactively and the Gate switches to the app.
    } catch (err) {
      setError(inviteErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h1>Mám pozvánku</h1>
      <label className="field">
        <span>Kód pozvánky</span>
        <input
          className="input code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="K7M-2QX"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          autoFocus
        />
      </label>
      <p className="muted small">Kód ti pošle člen domácnosti z Nastavení. Můžeš vložit i celý odkaz.</p>
      <button className="btn primary" type="submit" disabled={busy || code.trim() === ""}>
        {busy ? "Připojuji…" : "Připojit se"}
      </button>
      <button className="btn" type="button" onClick={onBack} disabled={busy}>Zpět</button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
