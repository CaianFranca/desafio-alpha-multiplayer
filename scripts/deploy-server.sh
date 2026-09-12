#!/usr/bin/env bash
# deploy-server.sh — publica uma release no servidor (roda NO servidor, como root).
#
# Uso: deploy-server.sh <sha> [tarball]
#   sha      — SHA curto que nomeia a release (ex.: a1b2c3d)
#   tarball  — opcional; default /tmp/flicker-<sha>.tar.gz (enviado por scp)
#
# Passos: extrair → migrations (knex JS) → instalar units/nginx → flip do
# symlink current → restart units → health check (com rollback automático) →
# reload nginx → retenção das últimas 3 releases.
#
# Pré-requisitos (bootstrap): node 24 em /usr/local/bin, postgresql 17, redis,
# nginx, usuário flicker, /opt/flicker/{releases,env}.
set -euo pipefail

SHA="${1:?uso: deploy-server.sh <sha> [tarball]}"
TARBALL="${2:-/tmp/flicker-${SHA}.tar.gz}"

ROOT=/opt/flicker
RELEASES="$ROOT/releases"
CURRENT="$ROOT/current"
ENV_FILE="$ROOT/env"
KEEP_RELEASES=3
HEALTH_TIMEOUT=60

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERRO: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "rode como root"
[ -f "$TARBALL" ] || die "tarball não encontrado: $TARBALL"
[ -f "$ENV_FILE" ] || die "env não encontrado: $ENV_FILE"
command -v systemctl >/dev/null || die "systemd não disponível"

RELEASE_DIR="$RELEASES/$SHA"
STAGING="$RELEASES/$SHA.tmp"
PREVIOUS=""
[ -L "$CURRENT" ] && PREVIOUS="$(readlink -f "$CURRENT" || true)"

cleanup() { rm -rf "$STAGING"; }
trap cleanup EXIT

# ── 1. Extrair (staging + mv atômico; redeploy do mesmo SHA é idempotente) ──
log "extraindo $TARBALL → $RELEASE_DIR"
rm -rf "$STAGING" "$RELEASE_DIR.tmp"
mkdir -p "$STAGING"
tar -xzf "$TARBALL" -C "$STAGING" --strip-components=1
[ -d "$STAGING/backend/lobby-server/src" ] || die "tarball não contém backend/lobby-server/src"
rm -rf "$RELEASE_DIR"
mv "$STAGING" "$RELEASE_DIR"
rm -rf "$RELEASES/$SHA.tmp"

# ── 2. Permissões: flicker dono; nginx (outros) lê frontend/media ───────────
chown -R flicker:flicker "$RELEASE_DIR"
chmod -R u+rwX,go+rX "$RELEASE_DIR"
chmod o+x "$ROOT" "$RELEASES"

# ── 3. Migrations (knex compilado; env de produção do EnvironmentFile) ──────
log "rodando migrations"
set -a; . "$ENV_FILE"; set +a
export NODE_ENV=production
( cd "$RELEASE_DIR/db" && ./node_modules/.bin/knex migrate:latest --knexfile dist/knexfile.js )

# ── 4. Instalar units systemd + conf nginx ──────────────────────────────────
log "instalando units e nginx conf"
cp "$RELEASE_DIR/infra/systemd/"*.service /etc/systemd/system/ 2>/dev/null \
  || die "units systemd não encontradas no tarball (esperado: infra/systemd/)"
systemctl daemon-reload
cp "$RELEASE_DIR/infra/nginx/nginx.prod.conf" /etc/nginx/sites-available/flicker
ln -sfn /etc/nginx/sites-available/flicker /etc/nginx/sites-enabled/flicker
# Vhost de borda (:80, default_server) que recebe /server01 do proxy do admin e
# faz strip do prefixo rumo ao nginx do app em 127.0.0.1:8080.
cp "$RELEASE_DIR/infra/nginx/nginx.edge.conf" /etc/nginx/sites-available/flicker-edge
ln -sfn /etc/nginx/sites-available/flicker-edge /etc/nginx/sites-enabled/flicker-edge
# O site default do Debian também é default_server em :80 e conflitaria com a
# borda; removemos o symlink (o arquivo em sites-available é preservado).
rm -f /etc/nginx/sites-enabled/default
nginx -t || die "nginx -t falhou; conf não aplicada"

# ── 5. Flip do symlink (atômico) + publicação do docroot ────────────────────
log "flip: current → $RELEASE_DIR"
ln -sfn "$RELEASE_DIR" "$CURRENT"

# Docroot do frontend lido pelo nginx do app: /var/www/html -> <release>/frontend/dist.
# O rm -rf remove o symlink/dir anterior; ln -sfn aponta para a release nova.
mkdir -p /var/www
rm -rf /var/www/html
ln -sfn "$RELEASE_DIR/frontend/dist" /var/www/html

# ── 6. Restart + health check (rollback automático p/ release anterior) ─────
log "reiniciando flicker-lobby e flicker-game"
systemctl restart flicker-lobby.service flicker-game.service

LOBBY_PORT="${LOBBY_SERVER_PORT:-3001}"
GAME_PORT="${GAME_SERVER_PORT:-1234}"

rollback() {
  log "FALHA no health check — rollback para ${PREVIOUS:-<nenhuma>}"
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE_DIR" ]; then
    ln -sfn "$PREVIOUS" "$CURRENT"
    systemctl restart flicker-lobby.service flicker-game.service
    log "rollback concluído; release $SHA permanece em disco"
  else
    log "não há release anterior para rollback"
  fi
}

health() { # $1=porta
  curl -fsS --max-time 2 "http://127.0.0.1:$1/health" >/dev/null
}

for attempt in $(seq 1 "$HEALTH_TIMEOUT"); do
  if health "$LOBBY_PORT" && health "$GAME_PORT"; then
    log "health OK (lobby:$LOBBY_PORT, game:$GAME_PORT) após ${attempt}s"
    break
  fi
  if [ "$attempt" -eq "$HEALTH_TIMEOUT" ]; then
    journalctl -u flicker-lobby.service -u flicker-game.service --since "2 minutes ago" --no-pager | tail -30 || true
    rollback
    exit 1
  fi
  sleep 1
done

# ── 7. Reload nginx (zero downtime) ──────────────────────────────────────────
systemctl reload nginx
log "nginx reloaded"

# ── 8. Retenção: manter as últimas N releases (current/previous nunca) ──────
log "retenção: mantendo últimas $KEEP_RELEASES releases"
cd "$RELEASES"
ls -1dt */ 2>/dev/null | grep -v '\.tmp' | tail -n +$((KEEP_RELEASES + 1)) | \
  while read -r old; do
    old="${old%/}"
    [ "$RELEASES/$old" = "$PREVIOUS" ] && continue
    rm -rf "$RELEASES/$old"
    log "release antiga removida: $old"
  done

log "deploy $SHA concluído"
