#!/usr/bin/env bash
# build-release.sh — monta o artefato de release do Flicker of Sanity.
#
# Produz flicker-{sha}.tar.gz contendo TUDO que o servidor precisa em runtime
# (o servidor nunca compila, nunca roda TS e nunca roda build/testes):
#   - backend lobby+game (fonte TS, rodado com tsx em produção — tsx é dependency)
#   - packages config/shared/engine (fonte TS, exposto via main/exports)
#   - node_modules de produção (raiz + db)
#   - db compilado para JS (knexfile.js + migrations em dist/)
#   - frontend buildado (vite, base /server01/) com media/ dentro do dist
#   - infra/nginx: conf do app + vhost de borda (instalados pelo deploy)
#
# Uso: scripts/build-release.sh [sha]
#   sha       — opcional; default = git rev-parse --short HEAD
# Saída: release/flicker-{sha}.tar.gz (ignorado pelo git)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SHA="${1:-$(git rev-parse --short HEAD)}"
STAGING="$(mktemp -d)/flicker"
OUT_DIR="$REPO_ROOT/release"
TARBALL="$OUT_DIR/flicker-${SHA}.tar.gz"

log() { printf '[build-release] %s\n' "$*"; }
die() { printf '[build-release] ERRO: %s\n' "$*" >&2; exit 1; }

command -v npm >/dev/null || die "npm não encontrado"
command -v tar >/dev/null || die "tar não encontrado"

mkdir -p "$STAGING" "$OUT_DIR"

# ── 1. Manifests da raiz (workspaces) ────────────────────────────────────────
log "copiando manifests da raiz"
cp package.json package-lock.json "$STAGING/"

# ── 2. Workspaces: packages + backends (manifests + fonte TS) ────────────────
log "copiando packages e backends"
for pkg in config shared engine; do
  mkdir -p "$STAGING/packages/$pkg"
  cp "packages/$pkg/package.json" "$STAGING/packages/$pkg/"
  cp -r "packages/$pkg/src" "$STAGING/packages/$pkg/src"
done
for srv in lobby-server game-server; do
  mkdir -p "$STAGING/backend/$srv"
  cp "backend/$srv/package.json" "$STAGING/backend/$srv/"
  cp -r "backend/$srv/src" "$STAGING/backend/$srv/src"
done

# ── 3. node_modules de produção (raiz + workspaces, inclui tsx) ──────────────
log "npm ci --omit=dev (raiz; pode demorar)"
( cd "$STAGING" && npm ci --omit=dev --no-audit --no-fund )

# ── 4. db: compilar knexfile+migrations para JS, depois deps de produção ────
log "compilando db para JS"
mkdir -p "$STAGING/db"
cp db/package.json db/package-lock.json db/tsconfig.json db/knexfile.ts "$STAGING/db/"
cp -r db/migrations db/seeds "$STAGING/db/"
( cd "$STAGING/db" \
  && npm ci --no-audit --no-fund \
  && npx tsc \
  && rm -rf node_modules \
  && npm ci --omit=dev --no-audit --no-fund )
[ -f "$STAGING/db/dist/knexfile.js" ] || die "db/dist/knexfile.js não foi gerado"
[ -d "$STAGING/db/dist/migrations" ] || die "db/dist/migrations não foi gerado"

# ── 5. frontend: build vite + media ──────────────────────────────────────────
log "buildando frontend (vite)"
mkdir -p "$STAGING/frontend"
rsync -a --exclude node_modules --exclude dist frontend/ "$STAGING/frontend/"
( cd "$STAGING/frontend" \
  && npm ci --no-audit --no-fund \
  && VITE_BASE_PATH=/server01/ NODE_ENV=production npm run build )
[ -f "$STAGING/frontend/dist/index.html" ] || die "frontend/dist/index.html não foi gerado"

# Copia a mídia para dentro do dist: o nginx do app serve /media/ como alias
# para /var/www/html/media/ (docroot = <release>/frontend/dist).
mkdir -p "$STAGING/frontend/dist/media"
cp -r frontend/web/media/. "$STAGING/frontend/dist/media/"

# ── 6. infra (units systemd + nginx conf — deploy-server.sh instala daqui) ──
log "copiando infra"
mkdir -p "$STAGING/infra/systemd" "$STAGING/infra/nginx"
cp infra/systemd/*.service "$STAGING/infra/systemd/"
cp infra/nginx/nginx.prod.conf "$STAGING/infra/nginx/nginx.prod.conf"
cp infra/nginx/nginx.edge.conf "$STAGING/infra/nginx/nginx.edge.conf"
# Snippets incluídos por nginx.prod.conf e nginx.edge.conf (deploy-server.sh
# instala em /etc/nginx/conf.d/ — mesma extensão .snippet, sem auto-carregamento).
cp infra/nginx/hsts-map.snippet "$STAGING/infra/nginx/hsts-map.snippet"
cp infra/nginx/security-headers.snippet "$STAGING/infra/nginx/security-headers.snippet"
cp infra/nginx/security-headers-static.snippet "$STAGING/infra/nginx/security-headers-static.snippet"
cp infra/nginx/rate-limit.snippet "$STAGING/infra/nginx/rate-limit.snippet"
cp infra/nginx/cloudflare-realip.snippet "$STAGING/infra/nginx/cloudflare-realip.snippet"

# ── 7. Empacotar ─────────────────────────────────────────────────────────────
log "empacotando $TARBALL"
tar -czf "$TARBALL" -C "$(dirname "$STAGING")" flicker

SIZE=$(du -h "$TARBALL" | cut -f1)
log "OK: $TARBALL ($SIZE)"
