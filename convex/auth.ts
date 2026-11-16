import { setupConvexAuth } from "@convex-dev/auth/server";
import { setupGoogle } from "@convex-dev/auth/methods/google/server";
import { setupUsernamePassword } from "@convex-dev/auth/methods/username-password/server";
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

// Fake test sign-in for Vercel previews only: `createUserTest` refuses to
// create an account unless `testMode` is on (see testLogin.ts).
export const { signUpWithUsernamePassword, signInWithUsernamePassword } =
  setupUsernamePassword(auth, {
    component: components.authPassword,
    usernameComponent: components.authUsername,
  }).attachUserCallbacks({ createUser: internal.users.createUserTest });
