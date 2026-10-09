# Privacy

Lecture Scribe is designed so that **nothing leaves your computer unless you turn on an optional feature or paste text somewhere yourself**.
This document describes how the software is built. It is not legal advice, and it cannot cover the services you choose to use.

## What stays on your computer (default)

- **Audio** you record and the **transcripts** are written to `local-server/data/` (or the folder named by `data_dir` in `config.json`).
- **Course term lists** are stored in `local-server/courses.json`; **server settings and the access token** in `local-server/config.json`.
- **Extension settings** (field of study, country, language, colour, token, server address) are stored in the browser with `chrome.storage.local`. They are not synced through your Google account.
- The server listens on `127.0.0.1` only, so other devices on your network cannot reach it, and every request needs the random token created on your first run.
- There is no analytics, telemetry, advertising or crash reporting in this software.

## Network connections that happen by default

- **Speech model download.** `install.sh` / `install.ps1` (or the first server start) download the Whisper model from Hugging Face through the `faster-whisper` library. This is a normal file download; it does not send your recordings. Python package installation (pip) also uses the internet.

## Optional features: where data goes if you switch them on

| Feature | What is sent, and to whom |
|---|---|
| **Export folder** | Transcript Markdown (and audio if you press "Save audio to export folder") is written to a folder you choose. If it is inside Google Drive, OneDrive or Dropbox, that service syncs it to your cloud account under its own terms. |
| **Live Google Docs** | Each transcript part is sent to a Google Apps Script web app in **your** Google account, which writes it into your Doc. |
| **Cloudflare Worker** | Audio and transcripts are sent to and stored in **your** Cloudflare account (Workers AI and R2). |
| **Local AI notes (Ollama)** | Transcript text is sent to an Ollama server, `http://localhost:11434` by default, which runs on your computer. |
| **Study prompts** | Nothing is sent by Lecture Scribe. When you paste a prompt into Gemini, ChatGPT, Claude or NotebookLM, that lecture's transcript goes to that service under its terms and privacy policy. |

## Other people's voices

Lectures contain other people's voices and sometimes personal data (the lecturer, classmates asking questions). Recording and storing them may be regulated where you live. See [RESPONSIBLE_USE.md](RESPONSIBLE_USE.md).

## Deleting your data

Delete a lecture in the library to remove its audio, transcript and any exported copy. A live Google Doc and anything you pasted into an AI service are not touched; remove those yourself. To remove everything, delete the `local-server/data` folder, `config.json` and `courses.json`, and remove the extension.

## Your token

The token in `config.json` protects the local server from other websites and programs. Do not share it, post it online or commit it to a public repository (`config.json` is in `.gitignore`).
