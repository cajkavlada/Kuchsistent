import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  useSignInWithUsernamePassword,
  useSignUpWithUsernamePassword,
} from "@convex-dev/auth/methods/username-password/react";
import { api } from "@convex/_generated/api";

/**
 * Fake sign-in for Vercel preview deploys (see convex/testLogin.ts). Renders
 * nothing unless the backend has test mode on, so production never shows it.
 */
const TESTERS = ["A", "B", "C"] as const;
// Not a secret: these accounts can only exist on throwaway preview backends.
const PASSWORD = "kuchsistent-preview-only";
const NAME_KEY = "kuchsistent.testerName";

export function TestLogin() {
  const enabled = useQuery(api.testLogin.enabled);
  const { signIn } = useSignInWithUsernamePassword(api.auth);
  const { signUp } = useSignUpWithUsernamePassword(api.auth);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!enabled) return null;

  async function signInAs(tester: string) {
    setBusy(tester);
    setError(null);
    const credentials = { username: `tester-${tester.toLowerCase()}`, password: PASSWORD };
    try {
      localStorage.setItem(NAME_KEY, `Tester ${tester}`);
    } catch {
      // Name stays "Tester".
    }
    const signedIn = await signIn(credentials);
    if (signedIn.status === "complete") return;
    const signedUp = await signUp(credentials);
    if (signedUp.status !== "complete") {
      console.error("Test sign-in failed", signedIn, signedUp);
      setError("Testovací přihlášení se nepodařilo.");
      setBusy(null);
    }
  }

  return (
    <div className="test-login">
      <p className="small"><strong>Testovací přihlášení</strong> (jen náhledová verze)</p>
      <div className="row">
        {TESTERS.map((t) => (
          <button key={t} className="btn" disabled={busy !== null} onClick={() => signInAs(t)}>
            {busy === t ? "…" : `Tester ${t}`}
          </button>
        ))}
      </div>
      <p className="muted small">Každý tester je samostatný účet. Druhého otevři v anonymním okně.</p>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/** After a test sign-in: give the account its "Tester X" name once. */
export function ApplyTesterName() {
  const setName = useMutation(api.testLogin.setName);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    let name: string | null = null;
    try {
      name = localStorage.getItem(NAME_KEY);
      localStorage.removeItem(NAME_KEY);
    } catch {
      return;
    }
    if (name) setName({ name }).catch(() => {});
  }, [setName]);
  return null;
}
