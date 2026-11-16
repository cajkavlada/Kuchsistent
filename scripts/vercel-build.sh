#!/bin/sh
# Vercel build (see vercel.json). Production: deploy Convex, then build.
# Previews: recreate the branch's Convex preview backend on every push
# (--preview-create), because a reused backend never re-runs --preview-run,
# so seed:preview (sample data + the fake test sign-in) would go missing.
set -e
if [ "$VERCEL_ENV" = "preview" ]; then
  set -- --preview-create "$VERCEL_GIT_COMMIT_REF"
fi
exec npx convex deploy "$@" \
  --cmd 'npm run build' \
  --cmd-url-env-var-name VITE_CONVEX_URL \
  --preview-run 'seed:preview'
