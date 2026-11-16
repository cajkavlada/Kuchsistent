/// <reference types="vite/client" />
import {
  ClientOnly,
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ConvexProviders } from "~/convex";
import { Gate } from "~/components/Gate";
import { Splash } from "~/components/Splash";
import "~/pwa"; // registers the service worker, catches the install prompt
import css from "~/styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { name: "theme-color", content: "#2f6b3a" },
      { title: "Kuchsistent" },
    ],
    links: [
      { rel: "stylesheet", href: css },
      { rel: "manifest", href: "/site.webmanifest" },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: Shell,
  component: Root,
});

function Shell({ children }: { children: ReactNode }) {
  return (
    <html lang="cs">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function Root() {
  return (
    <ClientOnly fallback={<Splash />}>
      <ConvexProviders>
        <Gate>
          <Outlet />
        </Gate>
      </ConvexProviders>
    </ClientOnly>
  );
}
