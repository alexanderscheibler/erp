#!/usr/bin/env bash
# wait-for-odoo.sh
# Polls Odoo until it responds with a valid login page.
# Odoo takes 2-5 minutes on first boot when installing modules with demo data.
#
# Usage: ./scripts/wait-for-odoo.sh [url] [max_attempts] [sleep_seconds]

set -euo pipefail

URL="${1:-http://localhost:8069/web/login}"
MAX_ATTEMPTS="${2:-60}"   # 60 × 5s = 5 minutes max
SLEEP_SEC="${3:-5}"

echo "⏳ Waiting for Odoo at ${URL} (max ${MAX_ATTEMPTS} attempts, ${SLEEP_SEC}s apart)..."

for i in $(seq 1 "${MAX_ATTEMPTS}"); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "${URL}" || true)

  if [[ "${HTTP_CODE}" == "200" ]]; then
    # Extra check: make sure the DB is actually initialized (not just the DB manager)
    BODY=$(curl -s --max-time 8 "${URL}" || true)
    if echo "${BODY}" | grep -q "login"; then
      echo "✅ Odoo is ready (attempt ${i}/${MAX_ATTEMPTS})"
      exit 0
    fi
  fi

  echo "   attempt ${i}/${MAX_ATTEMPTS} — HTTP ${HTTP_CODE}, retrying in ${SLEEP_SEC}s..."
  sleep "${SLEEP_SEC}"
done

echo "❌ Odoo did not become ready after $((MAX_ATTEMPTS * SLEEP_SEC))s"
exit 1
