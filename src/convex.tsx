import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { useState, type ReactNode } from "react";
import { api } from "@convex/_generated/api";

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined;

/** Convex client + Convex Auth. Rendered only in the browser (SPA mode). */
export function ConvexProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    if (!CONVEX_URL) throw new Error("VITE_CONVEX_URL is not set");
    return new ConvexReactClient(CONVEX_URL);
  });
  return (
    <ConvexAuthProvider
      client={client}
      api={{
        refreshSession: api.auth.refreshSession,
        signOut: api.auth.signOut,
        isAuthenticated: api.auth.isAuthenticated,
      }}
    >
      {children}
    </ConvexAuthProvider>
  );
}
