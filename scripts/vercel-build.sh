#!/bin/sh
# Vercel build (see vercel.json): deploy Convex production, then build the app.
# Only main deploys: vercel.json's git.deploymentEnabled turns off every
# other branch, so no Convex preview backends are created.
set -e
exec npx convex deploy \
  --cmd 'npm run build' \
  --cmd-url-env-var-name VITE_CONVEX_URL
