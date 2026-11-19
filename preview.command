#!/bin/bash
# Local preview of the AVM page with all media served from this folder (double-click on macOS).
SELF="$0"; [ -L "$SELF" ] && SELF="$(readlink "$SELF")"
cd "$(dirname "$SELF")" || exit 1
PORT=${PORT:-8000}
if [ -z "${NO_OPEN:-}" ]; then ( sleep 1; open "http://localhost:$PORT/" ) & fi
echo "Serving $(pwd) at http://localhost:$PORT/  (Ctrl+C to stop)"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
