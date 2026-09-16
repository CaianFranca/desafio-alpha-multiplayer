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
REDIS_CONF="${REDIS_CONF:-/etc/redis/redis.conf}"
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
[ -n "${REDIS_PASSWORD:-}" ] || die "REDIS_PASSWORD vazio no env ($ENV_FILE) — defina PROD_REDIS_PASSWORD no workflow"
# Normaliza senha (trim) para não divergir do getConfig() que faz trim
REDIS_PASSWORD="$(printf '%s' "$REDIS_PASSWORD" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
[ -n "$REDIS_PASSWORD" ] || die "REDIS_PASSWORD vazia após trim — verifique o secret"
# Garante requirepass no Redis nativo — fail-closed se conf ausente ou redis-cli ausente
if [ ! -f "$REDIS_CONF" ]; then
  die "redis.conf ausente em $REDIS_CONF — instale redis-server e garanta requirepass"
fi
if ! command -v redis-cli >/dev/null 2>&1; then
  die "redis-cli ausente — instale redis-tools para validar requirepass"
fi
log "garantindo requirepass em $REDIS_CONF"
tmp_conf="$(mktemp)"
tmp_conf2="${tmp_conf}.2"
new_conf="${REDIS_CONF}.deploy.new"
cleanup_conf() { rm -f "$tmp_conf" "$tmp_conf2" "$new_conf" 2>/dev/null || true; }
# Preserva permissões/dono do arquivo original
orig_stat="$(stat -c '%a %u %g' "$REDIS_CONF" 2>/dev/null || echo '640 0 0')"
# shellcheck disable=SC2206
orig_perm=($orig_stat)
grep -vE '^\s*requirepass\s+' "$REDIS_CONF" > "$tmp_conf" || true
# Também remove linha comentada # requirepass para evitar duplicidade
grep -vE '^\s*#\s*requirepass\s+' "$tmp_conf" > "$tmp_conf2" && mv "$tmp_conf2" "$tmp_conf" || true
printf 'requirepass %s\n' "$REDIS_PASSWORD" >> "$tmp_conf"
# Só substitui se mudou (evita restart desnecessário)
if ! cmp -s "$tmp_conf" "$REDIS_CONF"; then
  # Backup único, legível só pelo root (contém a senha em plaintext); remove legados .bak.<ts>
  rm -f "${REDIS_CONF}".bak.* 2>/dev/null || true
  ( umask 077; cp "$REDIS_CONF" "${REDIS_CONF}.bak" ) 2>/dev/null || true
  # Escrita atômica: monta o conf novo no mesmo filesystem e renomeia (rename é atômico)
  cp "$tmp_conf" "$new_conf" 2>/dev/null || die "não foi possível preparar $new_conf — verifique espaço/permissões"
  chmod "${orig_perm[0]}" "$new_conf" 2>/dev/null || chmod 640 "$new_conf" 2>/dev/null || true
  if [ "${#orig_perm[@]}" -ge 3 ]; then
    chown "${orig_perm[1]}:${orig_perm[2]}" "$new_conf" 2>/dev/null || chown redis:redis "$new_conf" 2>/dev/null || true
  fi
  mv -f "$new_conf" "$REDIS_CONF"
  log "requirepass atualizado — reiniciando redis"
  systemctl restart redis-server 2>/dev/null || systemctl restart redis 2>/dev/null || true
  # Aguarda redis ficar pronto com a nova senha (fail-closed: aborta deploy se não subir)
  # Usa REDISCLI_AUTH para não expor a senha em /proc/cmdline
  for i in $(seq 1 10); do
    if REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping 2>/dev/null | grep -q PONG; then
      log "redis pronto com requirepass (tentativa $i)"
      break
    fi
    if [ "$i" -eq 10 ]; then
      log "ERRO: redis não respondeu PONG após requirepass — restaurando backup"
      if [ -f "${REDIS_CONF}.bak" ]; then
        cp "${REDIS_CONF}.bak" "$REDIS_CONF"
        systemctl restart redis-server 2>/dev/null || systemctl restart redis 2>/dev/null || true
      fi
      cleanup_conf
      die "redis com requirepass não subiu — verifique $REDIS_CONF"
    fi
    sleep 1
  done
fi
cleanup_conf
( cd "$RELEASE_DIR/db" && ./node_modules/.bin/knex migrate:latest --knexfile dist/knexfile.js )

# ── 4. Instalar units systemd + conf nginx ──────────────────────────────────
log "instalando units e nginx conf"
cp "$RELEASE_DIR/infra/systemd/"*.service /etc/systemd/system/ 2>/dev/null \
  || die "units systemd não encontradas no tarball (esperado: infra/systemd/)"
systemctl daemon-reload
cp "$RELEASE_DIR/infra/nginx/nginx.prod.conf" /etc/nginx/sites-available/flicker
ln -sfn /etc/nginx/sites-available/flicker /etc/nginx/sites-enabled/flicker
# Snippets incluídos por nginx.prod.conf via caminho absoluto
# /etc/nginx/conf.d/*.snippet (extensão .snippet = fora do auto-include
# `conf.d/*.conf` do Debian, só carregados pelo include explícito).
for snippet in hsts-map security-headers security-headers-static; do
  cp "$RELEASE_DIR/infra/nginx/$snippet.snippet" "/etc/nginx/conf.d/$snippet.snippet" \
    || die "snippet nginx ausente no tarball: infra/nginx/$snippet.snippet"
done
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
    # Reaponta o docroot para a release anterior; sem isso o rollback voltaria
    # o backend mas continuaria servindo o frontend da release que falhou.
    rm -rf /var/www/html
    ln -sfn "$PREVIOUS/frontend/dist" /var/www/html
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
