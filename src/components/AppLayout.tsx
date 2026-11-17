import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useLocked, useOfflineShell, usePendingTicks } from "~/offline";
import { InstallBanner } from "./InstallBanner";
import { OfflineNotice } from "./Offline";

const TABS = [
  { to: "/plan", label: "Plán", icon: "📅" },
  { to: "/recepty", label: "Recepty", icon: "📖" },
  { to: "/nakup", label: "Nákup", icon: "🛒" },
  { to: "/nastaveni", label: "Nastavení", icon: "⚙️" },
] as const;

/**
 * The tabs and the page. Offline (#13, #32) only the shopping list works:
 * every other page keeps showing what it has but its controls are disabled
 * (one `<fieldset disabled>`), and in the offline start screen it shows just
 * "Bez připojení".
 */
export function AppLayout({ children }: { children: ReactNode }) {
  const shell = useOfflineShell();
  const locked = useLocked();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const shop = path.startsWith("/nakup");
  return (
    <div className="app">
      <div className="content">
        {locked && <OfflineBanner />}
        <InstallBanner />
        {shell && !shop ? (
          <OfflineNotice />
        ) : (
          <>
            {locked && !shop && (
              <p className="offline-note">
                {path.startsWith("/recepty/vyfotit")
                  ? "Bez připojení – na přečtení fotky je potřeba internet."
                  : "Bez připojení – změny půjdou udělat, až bude signál."}
              </p>
            )}
            <fieldset className="offline-lock" disabled={locked && !shop}>
              {children}
            </fieldset>
          </>
        )}
      </div>
      <nav className="tabbar" aria-label="Hlavní navigace">
        {TABS.map((t) => (
          <Link key={t.to} to={t.to} className="tab" activeProps={{ className: "tab active" }}>
            <span aria-hidden="true">{t.icon}</span>
            <span>{t.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** Thin app-wide banner after ~3 s without connection (#13). */
function OfflineBanner() {
  const pending = Object.keys(usePendingTicks()).length;
  return (
    <div className="offline-banner" role="status">
      <span>Offline – odškrtnutí se uloží po připojení</span>
      {pending > 0 && <b>{pending} čeká</b>}
    </div>
  );
}

export function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <section className="page">
      <h1>{title}</h1>
      <p className="muted">{text}</p>
    </section>
  );
}
