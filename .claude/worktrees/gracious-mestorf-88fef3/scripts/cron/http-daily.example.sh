#!/usr/bin/env bash
# Ejemplo: llamar los crons HTTP desde el servidor donde corre Next (o desde un job externo).
# Requiere: BASE_URL (pública o interna), CRON_SECRET.
# Configurá la zona horaria en tu scheduler (systemd, Cloud Scheduler, Task Scheduler, etc.).
#
# Uso:
#   export BASE_URL=https://tu-app.example.com
#   export CRON_SECRET=...
#   bash scripts/cron/http-daily.example.sh

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
SECRET="${CRON_SECRET:-}"

if [[ -z "$SECRET" ]]; then
  echo "Definí CRON_SECRET" >&2
  exit 1
fi

AUTH=( -H "Authorization: Bearer ${SECRET}" )

curl -fsS "${AUTH[@]}" "${BASE_URL}/api/cron/actualizar-vencimientos"
echo " → actualizar-vencimientos OK"

curl -fsS "${AUTH[@]}" "${BASE_URL}/api/cron/motor-ot-diario"
echo " → motor-ot-diario OK"
