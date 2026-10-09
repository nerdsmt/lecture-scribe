// Lecture Scribe - live Google Doc writer (Web App).   OPTIONAL / ADVANCED
// Your computer's local server POSTs each new transcript chunk here; this appends it to a Doc in YOUR Google account.
// Nothing in this repo contains a secret: you create the secret yourself and keep it only in Script Properties.
//
// Setup (full steps in docs/OPTIONAL_GOOGLE_DOCS.md):
//  1. script.google.com -> New project -> paste this file.
//  2. Project Settings -> Script Properties -> Add property:  name SECRET, value = a long random string you invent.
//  3. Deploy -> New deployment -> type "Web app" -> Execute as: Me -> Who has access: Anyone -> Deploy.
//  4. Put the Web app URL and the same secret in the extension Options (section "live Google Docs").
// The first run asks you to authorise Docs access (Review permissions -> Allow).
// "Anyone" can reach the URL, but every request must carry your secret, so keep the secret private.

function doPost(e) {
  try {
    const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || secret.length < 16) return out_({ error: 'SECRET is not set (or too short) in Script Properties' });
    const d = JSON.parse(e.postData.contents);
    if (d.key !== secret) return out_({ error: 'bad key' });
    const body = DocumentApp.openById(d.docId).getBody();
    if (d.n === 0) {
      body.appendParagraph(d.title || 'Lecture').setHeading(DocumentApp.ParagraphHeading.HEADING1);
      if (d.course) body.appendParagraph(d.course + ' - ' + d.date).editAsText().setItalic(true);
    }
    const p = body.appendParagraph('[' + d.stamp + '] ' + d.text);
    p.editAsText().setForegroundColor(0, d.stamp.length + 1, '#888888');
    DocumentApp.openById(d.docId).saveAndClose();
    return out_({ ok: true });
  } catch (err) {
    return out_({ error: String(err) });
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
