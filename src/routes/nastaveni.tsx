import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@convex/_generated/api";

export const Route = createFileRoute("/nastaveni")({ component: Settings });

function Settings() {
  const household = useQuery(api.households.current);
  const me = useQuery(api.households.me);
  const { signOut } = useAuthActions();
  return (
    <section className="page">
      <h1>Nastavení</h1>
      {me && <p>Přihlášen(a) jako {me.user.name ?? me.user.email}</p>}
      {household && <p className="muted">Výchozí počet porcí: {household.defaultPortions}</p>}
      <button className="btn" onClick={() => void signOut()}>Odhlásit se</button>
    </section>
  );
}
