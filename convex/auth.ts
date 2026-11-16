import { setupConvexAuth } from "@convex-dev/auth/server";
import { setupGoogle } from "@convex-dev/auth/methods/google/server";
import { components, internal } from "./_generated/api";
import { allowedRedirectOrigins } from "./lib/config";

const auth = setupConvexAuth({
  component: components.auth,
  // Long-lived sessions (#11): stay signed in for a year, and survive
  // up to 90 days without opening the app.
  sessionMaxLifetimeSeconds: 365 * 24 * 60 * 60,
  refreshInactivityTimeoutSeconds: 90 * 24 * 60 * 60,
});

export const { signOut, refreshSession, isAuthenticated } = auth;

export const { startSignInWithGoogle, completeSignInWithGoogle } = setupGoogle(
  auth,
  {
    component: components.authGoogle,
    allowedRedirectOrigins: allowedRedirectOrigins(),
  },
).attachUserCallbacks({
  createUser: internal.users.createUserGoogle,
  onSignIn: internal.users.onSignInGoogle,
});
