import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import { capturePendingInvite, clearPendingInvite, inviteErrorMessage } from "~/lib/invite";
import { Onboarding } from "./Onboarding";
import { SignIn } from "./SignIn";
import { Splash } from "./Splash";
import { AppLayout } from "./AppLayout";
import { ApplyTesterName } from "./TestLogin";
import { Offline } from "./Offline";
import { rememberMember, wasMember } from "~/pwa";
import { hasSavedList, ListKeeper, OfflineShellContext, TickSync, useConnection } from "~/offline";

/**
 * Signed out → sign-in; pending Invite → join; no Household → onboarding;
 * Member → the app. Opened without signal, a known Member gets the offline
 * start screen instead of waiting for sign-in (#13, #32).
 */
export function Gate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const [pendingInvite, setPendingInvite] = useState(capturePendingInvite);
  const shell = useOfflineStart();
  if (isLoading) return shell ? <OfflineShell>{children}</OfflineShell> : <Splash />;
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
      <Member shell={shell}>{children}</Member>
    </>
  );
}

function Member({ children, shell }: { children: ReactNode; shell: boolean }) {
  const me = useQuery(api.households.me);
  const isMember = me ? me.household !== null : null;
  useEffect(() => {
    if (isMember !== null) rememberMember(isMember);
  }, [isMember]);

  if (me === undefined) return shell ? <OfflineShell>{children}</OfflineShell> : <Splash />;
  if (me.household === null) return <Onboarding mayCreate={me.mayCreateHousehold} />;
  return (
    <>
      <TickSync />
      <ListKeeper />
      <AppLayout>{children}</AppLayout>
    </>
  );
}

/**
 * Whether the app started without signal: no network at all, or no
 * connection for ~3 s. Once true it stays true until the app is loaded, so
 * the switch to live data is one quiet step, not a flash of the splash.
 */
function useOfflineStart(): boolean {
  const { connected, offline, noNetwork } = useConnection();
  const latched = useRef(false);
  if (!connected && (offline || noNetwork)) latched.current = true;
  return latched.current;
}

/** Jump to the shopping list only once per app start. */
let jumpedToList = false;

/**
 * Started without signal (#13, #16, #32): Convex has no data on the device.
 * A known Member sees the app's tabs; the shopping list shows the saved copy
 * and opens first, other screens say "Bez připojení". Otherwise a plain
 * offline screen. The Gate switches to live data once connected.
 */
function OfflineShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const member = wasMember();
  useEffect(() => {
    if (jumpedToList || !member || !hasSavedList()) return;
    jumpedToList = true;
    if (!path.startsWith("/nakup")) void navigate({ to: "/nakup", replace: true });
  }, [member, path, navigate]);

  if (!member) return <Offline />;
  return (
    <OfflineShellContext.Provider value={true}>
      <AppLayout>{children}</AppLayout>
    </OfflineShellContext.Provider>
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
