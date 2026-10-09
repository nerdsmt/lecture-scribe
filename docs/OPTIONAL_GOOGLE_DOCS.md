# Optional: live Google Docs

**Advanced and optional.** This writes each transcript part into a Google Doc while you record. It uses a small script that runs in **your own Google account**; Google receives the transcript text. Skip it if you do not want that.

How it works: the local server on your computer sends each new transcript part over HTTPS to a Google Apps Script web app that you deploy. The script appends the text to the Doc you named.

## Setup (about 10 minutes, once)

1. Go to <https://script.google.com> and create a **New project**.
2. Replace the contents of `Code.gs` with the file `apps-script/LiveDoc.gs` from this repository.
3. Open **Project Settings** (gear icon), find **Script Properties**, and add a property:
   - name: `SECRET`
   - value: a long random string you invent (at least 16 characters). Keep it private; do not put it in any file in this repository.
4. Click **Deploy**, then **New deployment**, choose type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (anyone with the URL can call it, but every request must include your secret)
5. Click **Deploy** and approve the permissions screen (Review permissions, then Allow). Google may warn that the app is unverified: it is your own script.
6. Copy the **Web app URL**.
7. In the extension, open **Settings**, section "Advanced and optional: live Google Docs", paste the URL and the same secret, and press **Save**.
8. Create an empty Google Doc in the **same Google account**, copy its link, and paste it in the popup's **Live Google Doc link** box before you start recording. (That box only appears once the URL is saved.)

## Several Google accounts

If your Docs live in different accounts, copy `local-server/live.example.json` to `local-server/live.json` and list each account's web app URL and secret. The server tries them in order until one can edit the Doc. `live.json` is git-ignored.

## Troubleshooting

- "bad key": the secret in Settings differs from the `SECRET` property.
- "SECRET is not set": add the Script Property in step 3 and redeploy.
- "Document is missing" or permission errors: the Doc is not accessible to the Google account that owns the script. Create the Doc in that account or share it with it.
- After editing the script, use **Deploy, Manage deployments, Edit, New version**, otherwise the old code keeps running.
- The server window prints `live doc:` lines that show what happened to each part.

I could not verify the current wording of Google's Apps Script menus; if a step does not match, follow Google's own Apps Script documentation for deploying a web app.
