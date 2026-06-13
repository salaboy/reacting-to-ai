#!/usr/bin/env bash
#
# Start a local HTTP server and open three browser tabs:
#   1. the deck (reacting-to-ai.html)
#   2. the speaker-notes follower
#   3. the keynote demo (keynote-demo-styled.html)
#
# Usage:
#   ./start.sh                       # opens reacting-to-ai.html + notes + keynote demo
#   ./start.sh "<other-deck.html>"   # opens a different deck file in this dir
#
# Stop with Ctrl+C — the script will shut the server down for you.

set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-8002}"
DECK="${1:-reacting-to-ai.html}"
KEYNOTE_DEMO="keynote-demo-styled.html"

if [[ ! -f "$DECK" ]]; then
  echo "Deck not found: $DECK"
  echo
  echo "Available decks in this directory:"
  ls -1 *.html 2>/dev/null | grep -v '^notes\.html$' | sed 's/^/  /'
  exit 1
fi

# URL-encode the deck filename (spaces, etc.) for the browser
DECK_ENC=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$DECK")
DECK_URL="http://localhost:${PORT}/${DECK_ENC}"
NOTES_URL="http://localhost:${PORT}/notes.html?deck=${DECK_ENC}"
KEYNOTE_DEMO_URL="http://localhost:${PORT}/${KEYNOTE_DEMO}"

# Reuse an existing server on the port if one's already there
SERVER_PID=""
if lsof -nP -i ":${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port ${PORT} already in use — reusing existing server."
else
  echo "Starting HTTP server on http://localhost:${PORT}/ ..."
  python3 -m http.server "${PORT}" >/dev/null 2>&1 &
  SERVER_PID=$!
  # Wait up to 2s for the port to come up
  for _ in $(seq 1 20); do
    if curl -s -o /dev/null "http://localhost:${PORT}/"; then break; fi
    sleep 0.1
  done
fi

cleanup() {
  if [[ -n "${SERVER_PID}" ]]; then
    kill "${SERVER_PID}" 2>/dev/null || true
    echo
    echo "Server stopped."
  fi
}
trap cleanup INT TERM EXIT

echo
echo "  Deck:    ${DECK_URL}"
echo "  Notes:   ${NOTES_URL}"
if [[ -f "${KEYNOTE_DEMO}" ]]; then
  echo "  Keynote: ${KEYNOTE_DEMO_URL}"
fi
echo

open "${DECK_URL}"
sleep 0.4
open "${NOTES_URL}"
if [[ -f "${KEYNOTE_DEMO}" ]]; then
  sleep 0.4
  open "${KEYNOTE_DEMO_URL}"
fi

echo "Tip: drag the notes/keynote tabs onto your laptop screen so the deck stays on the projector."
echo
echo "Press Ctrl+C to stop the server."

# Block until Ctrl+C (or until the server we started exits)
if [[ -n "${SERVER_PID}" ]]; then
  wait "${SERVER_PID}"
else
  while :; do sleep 3600; done
fi
