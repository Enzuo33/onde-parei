#!/bin/sh
# Publica o Onde Parei no Cloudflare Pages
# Monta pages/dist com o app (public/) + a API (worker.js vira _worker.js) e sobe no Pages.
set -e
cd "$(dirname "$0")"
rm -rf pages/dist && mkdir -p pages/dist
cp -r public/. pages/dist/
cp worker.js pages/dist/_worker.js
cat > pages/dist/_routes.json <<'R'
{ "version": 1, "include": ["/api/*"], "exclude": [] }
R
cd pages && npx wrangler pages deploy --branch main --commit-dirty=true
