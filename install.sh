#!/usr/bin/env bash
# Lecture Scribe installer for macOS and Linux. Safe to run again.
set -e
cd "$(dirname "$0")/local-server"

PY=""
for c in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "Python 3.10 or newer is needed. Install it from https://www.python.org/downloads/ and run this again."; exit 1
fi
echo "Using $($PY --version)"

[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/python -m pip install --quiet --upgrade pip
echo "Installing speech-recognition packages (a few minutes the first time)..."
.venv/bin/python -m pip install -r requirements.txt

echo
.venv/bin/python server.py --init
echo
echo "Downloading the speech model (one time; 150 MB to 1.5 GB depending on the model)..."
.venv/bin/python server.py --download-model
echo
echo "Done. Start the server with:  ./local-server/start.sh"
echo "Then load the extension (see README) and paste the token shown above into its Options."
