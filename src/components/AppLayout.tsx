import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { InstallBanner } from "./InstallBanner";

const TABS = [
  { to: "/plan", label: "Plán", icon: "📅" },
  { to: "/recepty", label: "Recepty", icon: "📖" },
  { to: "/nakup", label: "Nákup", icon: "🛒" },
  { to: "/nastaveni", label: "Nastavení", icon: "⚙️" },
] as const;

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <div className="content">
        <InstallBanner />
        {children}
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

export function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <section className="page">
      <h1>{title}</h1>
      <p className="muted">{text}</p>
    </section>
  );
}
