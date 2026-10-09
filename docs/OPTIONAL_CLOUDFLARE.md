# Optional: Cloudflare Worker

**Advanced and optional; most students should use the local server instead.** The Worker in `worker/` offers the same HTTP API as the local server but runs in **your own Cloudflare account**, using Cloudflare Workers AI for speech recognition and R2 for storage. Your audio and transcripts are then sent to and stored at Cloudflare under your account and its terms and pricing, so the "nothing leaves your computer" promise no longer applies. Check Cloudflare's current pricing and limits yourself; they change.

Use it when you cannot run the local server (for example a very slow computer) and accept the cloud trade-off.

## Setup

You need a Cloudflare account and Node.js.

```bash
cd worker
npm install
npx wrangler login
npx wrangler r2 bucket create lecture-scribe
npx wrangler secret put API_TOKEN      # paste a long random string you invent; it is stored by Cloudflare, not in this repo
npx wrangler deploy                    # prints https://lecture-scribe.<your-subdomain>.workers.dev
```

Then in the extension **Settings**, set the **Server address** to your Worker URL and the **Token** to the `API_TOKEN` you chose. Chrome asks permission to contact that address when you press Save.

The library's export-folder settings, `/config` and `/health` endpoints exist only on the local server.

## Google Docs sidebar (add-on style)

`apps-script/Code.gs`, `Sidebar.html` and `appsscript.json` are a Docs sidebar that pulls transcripts from a deployed Worker into an open Doc. Create an Apps Script project from them (script.google.com, show the manifest in Project Settings), then enter your Worker URL and token in the sidebar. Keep the token only in the sidebar's settings (stored in your own Apps Script user properties); never paste it into a file you commit.

## Keeping secrets out of git

Never commit `.dev.vars`, `.env` or tokens. They are in `.gitignore`. Use `wrangler secret put` for secrets.
