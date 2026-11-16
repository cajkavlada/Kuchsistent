# Kuchsistent

Czech household cooking assistant: recipe photos → meal plan → freshness-aware shopping list. TanStack Start (SPA mode) + Convex + Convex Auth v2, deployed on Vercel.

Planning happens in the GitHub issue labelled `wayfinder:map`. Domain terms: [GLOSSARY.md](GLOSSARY.md).

## Develop

```sh
npm install
npx convex dev        # first run: log in, create the project; writes .env.local
npm run dev           # http://localhost:3000
```

Set the Convex env vars below on the dev deployment too (`npx convex env set NAME value`), with `SITE_URL=http://localhost:3000`.

Checks: `npm run typecheck`, `npm test`.

## Code conventions

- Every public Convex function that touches Household data starts with `requireMember(ctx)` from `convex/lib/membership.ts` and scopes all reads and writes to the returned `household`.
- Calendar days are Europe/Prague days, `YYYY-MM-DD`: use `convex/lib/dates.ts` on client and server, never `toISOString()`.
- UI and data are Czech; code, issues and docs are English.

## Deploy setup (one-time)

**Google OAuth client** (Google Cloud Console → APIs & Services → Credentials → OAuth client ID, type *Web application*):
- Authorized redirect URI: `https://<deployment>.convex.site/oauth/google/callback`, one per Convex deployment you sign in on (production and dev).
- OAuth consent screen: External. Scopes are only `openid email profile`.

**Convex env vars** (production and dev deployments; for previews, set them as the project's default environment variables for preview deployments):

| Name | Value |
|---|---|
| `AUTH_GOOGLE_CLIENT_ID` | from the OAuth client |
| `AUTH_GOOGLE_CLIENT_SECRET` | from the OAuth client |
| `SITE_URL` | the app's origin, e.g. `https://kuchsistent.vercel.app` (comma-separate several) |
| `HOUSEHOLD_CREATOR_EMAILS` | comma-separated Google emails allowed to create a Household |
| `ANTHROPIC_API_KEY` | Claude API key, for reading Recipe photos |
| `GEMINI_API_KEY` | Gemini API key, the fallback reader |
| `EXTRACTION_MODELS` | optional; models tried in order, default `claude-sonnet-5-5,gemini-3.8-flash` (`claude-*` or `gemini-*`) |

**Vercel** (import the repo; `vercel.json` sets the framework and build command):
- `CONVEX_DEPLOY_KEY` = a Convex *Production* deploy key, scoped to the Production environment.
- `CONVEX_DEPLOY_KEY` = a Convex *Preview* deploy key, scoped to the Preview environment.
- No secrets with the `VITE_` prefix; `VITE_CONVEX_URL` is injected by `convex deploy`.

Each pushed branch then gets a Vercel preview backed by its own fresh Convex preview backend (seeded by `seed:preview`); merging to `main` deploys production.

Google sign-in on preview deploys can't complete, because each preview backend has its own `*.convex.site` callback URL that isn't registered with Google. Instead, `seed:preview` turns on a fake "Testovací přihlášení" (Tester A/B/C) on preview backends only; production never has it. Every push to a branch recreates its preview backend (`scripts/vercel-build.sh`), so preview data starts empty each time.
