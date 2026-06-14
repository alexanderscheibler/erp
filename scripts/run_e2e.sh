#!/usr/bin/env bash
# run_e2e.sh
# Full local E2E orchestration: spin up infra, wait, run tests, tear down.
# Run from the repo root: ./scripts/run_e2e.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

# ── Trap: always tear down on exit (even on failure) ──────────────────────────
cleanup() {
  echo ""
  echo "🧹 Tearing down containers..."
  docker compose down -v --remove-orphans
}
trap cleanup EXIT

# ── 1. Start fresh ─────────────────────────────────────────────────────────────
echo "🚀 Starting infrastructure (clean slate)..."
docker compose down -v --remove-orphans 2>/dev/null || true
docker compose up -d

# ── 2. Wait for Odoo to finish module install + demo data load ─────────────────
"${SCRIPT_DIR}/wait-for-odoo.sh"

# ── 3. Run Playwright tests ────────────────────────────────────────────────────
echo ""
echo "🎭 Running Playwright tests..."
npx playwright test "$@"

echo ""
echo "✅ All done."
