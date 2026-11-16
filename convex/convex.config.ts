import { defineApp } from "convex/server";
import { v } from "convex/values";
import auth from "@convex-dev/auth/convex.config";
import authGoogle from "@convex-dev/auth/components/google/convex.config";
import authPassword from "@convex-dev/auth/components/password/convex.config";
import authUsername from "@convex-dev/auth/components/username/convex.config";

const app = defineApp({
  env: {
    AUTH_GOOGLE_CLIENT_ID: v.string(),
    AUTH_GOOGLE_CLIENT_SECRET: v.string(),
  },
});

app.use(auth);
// Google's redirect URI is `<CONVEX_SITE_URL>/oauth/google/callback`.
app.use(authGoogle, {
  httpPrefix: "/oauth/google",
  env: {
    CLIENT_ID: app.env.AUTH_GOOGLE_CLIENT_ID,
    CLIENT_SECRET: app.env.AUTH_GOOGLE_CLIENT_SECRET,
  },
});

// Preview-only test sign-in (testLogin.ts). Mounted everywhere, but accounts
// can only be created where `testMode` is on.
app.use(authPassword);
app.use(authUsername);

export default app;
