import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import { capturePendingInvite, clearPendingInvite, inviteErrorMessage } from "~/lib/invite";
import { Onboarding } from "./Onboarding";
import { SignIn } from "./SignIn";
import { Splash } from "./Splash";
import { AppLayout } from "./AppLayout";
import { ApplyTesterName } from "./TestLogin";
import { Offline, OfflineNotice } from "./Offline";
import { rememberMember, useOnline, wasMember } from "~/pwa";

/**
 * Signed out → sign-in; pending Invite → join; no Household → onboarding;
 * Member → the app.
 */
export function Gate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const [pendingInvite, setPendingInvite] = useState(capturePendingInvite);
  const online = useOnline();
  if (isLoading) return online ? <Splash /> : <OfflineShell />;
  if (!isAuthenticated) return <SignIn invited={pendingInvite !== null} />;
  if (pendingInvite !== null) {
    return (
      <JoinWithInvite
        code={pendingInvite}
        onDone={() => {
          clearPendingInvite();
          setPendingInvite(null);
        }}
      />
    );
  }
  return (
    <>
      <ApplyTesterName />
      <Member>{children}</Member>
    </>
  );
}

function Member({ children }: { children: ReactNode }) {
  const me = useQuery(api.households.me);
  const online = useOnline();
  const isMember = me ? me.household !== null : null;
  useEffect(() => {
    if (isMember !== null) rememberMember(isMember);
  }, [isMember]);

  if (me === undefined) return online ? <Splash /> : <OfflineShell />;
  if (me.household === null) return <Onboarding mayCreate={me.mayCreateHousehold} />;
  return <AppLayout>{children}</AppLayout>;
}

/**
 * Started without signal (#13, #16): Convex has no data on the device, so
 * show the app's tabs with "Bez připojení" to known Members, otherwise a
 * plain offline screen. The Gate switches to live data once back online.
 */
function OfflineShell() {
  if (!wasMember()) return <Offline />;
  return (
    <AppLayout>
      <OfflineNotice />
    </AppLayout>
  );
}

/** Opened an Invite link: join automatically, or say clearly why not. */
function JoinWithInvite({ code, onDone }: { code: string; onDone: () => void }) {
  const redeem = useMutation(api.invites.redeem);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    redeem({ code }).then(
      () => {
        onDone();
        void navigate({ to: "/plan", replace: true });
      },
      (err) => setError(inviteErrorMessage(err)),
    );
  }, [code, redeem, onDone, navigate]);

  if (error === null) {
    return (
      <main className="center">
        <p className="logo">🍲 Kuchsistent</p>
        <p className="muted">Připojuji tě k domácnosti…</p>
      </main>
    );
  }
  return (
    <main className="center">
      <p className="logo">🍲 Kuchsistent</p>
      <h1>Pozvánku nelze použít</h1>
      <p className="error" role="alert">{error}</p>
      <button
        className="btn"
        onClick={() => {
          onDone();
          void navigate({ to: "/plan", replace: true });
        }}
      >
        Pokračovat
      </button>
    </main>
  );
}
