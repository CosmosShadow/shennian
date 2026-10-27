#!/usr/bin/env bash
set -euo pipefail

# @arch docs/engineering/build-and-release.md

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${ROOT_DIR}/packages/app"
APP_DIST="${APP_DIR}/dist"
APP_EXPO_DIR="${APP_DIR}/.expo"

log() {
  printf '==> %s\n' "$*"
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

[[ -d "${APP_DIR}" ]] || fail "missing app directory: ${APP_DIR}"
command -v npx >/dev/null 2>&1 || fail "npx is required"

export_tmpdir="$(mktemp -d -t shennian-web-export.XXXXXX)"
cleanup() {
  rm -rf "${export_tmpdir}"
}
trap cleanup EXIT

log "Cleaning Expo Web output"
rm -rf "${APP_DIST}" "${APP_EXPO_DIR}/web" "${APP_EXPO_DIR}/static-tmp"

log "Building workspace packages used by Expo Web"
(
  cd "${ROOT_DIR}"
  pnpm --filter @shennian/wire build
  pnpm --filter @shennian/shared build
)

log "Exporting Expo Web with isolated TMPDIR=${export_tmpdir}"
(
  cd "${APP_DIR}"
  SHENNIAN_WEB_ROUTE_ROOT=app-web TMPDIR="${export_tmpdir}" pnpm exec expo export --platform web "$@"
)

[[ -f "${APP_DIST}/index.html" ]] || fail "missing ${APP_DIST}/index.html after export"

log "Versioning Expo Web static asset references"
node "${ROOT_DIR}/scripts/cache-bust-web-assets.mjs" "${APP_DIST}"

log "Auditing lightweight Web product boundary"
node "${ROOT_DIR}/scripts/audit-web-retirement.mjs" --dist "${APP_DIST}" --require-final

log "Publishing canonical Shennian Skill"
cp "${ROOT_DIR}/plugins/shennian/skills/shennian/SKILL.md" "${APP_DIST}/skill.md"
cp "${ROOT_DIR}/packages/app/public/skill-manifest.json" "${APP_DIST}/skill-manifest.json"

log "Auditing published Agent no-JavaScript guide"
node "${ROOT_DIR}/scripts/audit-published-agent-html.mjs" "${APP_DIST}"

log "Expo Web output ready: ${APP_DIST}"
