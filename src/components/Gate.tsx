import { useConvexAuth, useQuery } from "convex/react";
import type { ReactNode } from "react";
import { api } from "@convex/_generated/api";
import { Onboarding } from "./Onboarding";
import { SignIn } from "./SignIn";
import { Splash } from "./Splash";
import { AppLayout } from "./AppLayout";

/** Signed out → sign-in; no Household → onboarding; Member → the app. */
export function Gate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return <Splash />;
  if (!isAuthenticated) return <SignIn />;
  return <Member>{children}</Member>;
}

function Member({ children }: { children: ReactNode }) {
  const me = useQuery(api.households.me);
  if (me === undefined) return <Splash />;
  if (me.household === null) return <Onboarding mayCreate={me.mayCreateHousehold} />;
  return <AppLayout>{children}</AppLayout>;
}
