#!/bin/sh
# Vercel build (see vercel.json): deploy Convex production, then build the app.
# Only production builds run; vercel.json's ignoreCommand skips every
# preview build, so no Convex preview backends are created.
set -e
exec npx convex deploy \
  --cmd 'npm run build' \
  --cmd-url-env-var-name VITE_CONVEX_URL
