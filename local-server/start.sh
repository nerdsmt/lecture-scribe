#!/usr/bin/env bash
# Starts the Lecture Scribe local server. Keep this window open while recording.
# Keeping the computer awake is handled by server.py itself (caffeinate / systemd-inhibit when available).
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then echo "Run ./install.sh first."; exit 1; fi
exec .venv/bin/python -u server.py
