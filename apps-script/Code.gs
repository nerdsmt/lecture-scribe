// Lecture Scribe – Google Docs sidebar. Pulls transcripts / study notes from the
// Cloudflare Worker into the open Doc and saves lecture audio to Drive.

function onOpen() {
  DocumentApp.getUi().createAddonMenu().addItem('Open Lecture Scribe', 'showSidebar').addToUi();
}
function onInstall() { onOpen(); }
function showSidebar() {
  DocumentApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('Lecture Scribe'));
}

function saveSettings(url, token) {
  PropertiesService.getUserProperties().setProperties({ WORKER_URL: url.replace(/\/$/, ''), TOKEN: token });
}
function getSettings() {
  const p = PropertiesService.getUserProperties();
  return { url: p.getProperty('WORKER_URL') || '', hasToken: !!p.getProperty('TOKEN') };
}

function call_(path, method) {
  const p = PropertiesService.getUserProperties();
  const res = UrlFetchApp.fetch(p.getProperty('WORKER_URL') + path, {
    method: method || 'get', headers: { Authorization: 'Bearer ' + p.getProperty('TOKEN') }, muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error('Worker error ' + res.getResponseCode() + ': ' + res.getContentText());
  return res;
}

function listLectures() {
  return JSON.parse(call_('/sessions').getContentText()).slice(0, 25)
    .map(function (s) { return { id: s.id, title: s.title || s.id, course: s.course || '', when: s.startedAt || 0 }; });
}

// Minimal Markdown -> Docs (headings, bullets, bold).
function appendMarkdown_(body, md) {
  md.split('\n').forEach(function (line) {
    if (!line.trim()) return;
    var m;
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) {
      body.appendParagraph(m[2]).setHeading([null, DocumentApp.ParagraphHeading.HEADING2, DocumentApp.ParagraphHeading.HEADING3, DocumentApp.ParagraphHeading.HEADING4][m[1].length]);
    } else if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
      body.appendListItem(m[1].replace(/\*\*/g, '')).setGlyphType(DocumentApp.GlyphType.BULLET);
    } else {
      body.appendParagraph(line.replace(/\*\*/g, ''));
    }
  });
}

function insertTranscript(id) {
  const d = JSON.parse(call_('/sessions/' + id).getContentText());
  const body = DocumentApp.getActiveDocument().getBody();
  body.appendParagraph((d.meta.title || 'Lecture') + ' – transcript').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  d.chunks.forEach(function (c) {
    const t = Math.floor(c.offset), mm = ('0' + Math.floor(t / 60)).slice(-2), ss = ('0' + (t % 60)).slice(-2);
    const p = body.appendParagraph('[' + mm + ':' + ss + '] ' + c.text);
    p.editAsText().setForegroundColor(0, mm.length + ss.length + 2, '#888888');
  });
  return d.chunks.length + ' segments inserted';
}

function insertNotes(id, refresh) {
  const n = JSON.parse(call_('/sessions/' + id + '/notes' + (refresh ? '?refresh=1' : ''), 'post').getContentText());
  const body = DocumentApp.getActiveDocument().getBody();
  body.appendParagraph('Study notes').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  appendMarkdown_(body, n.markdown);
  return 'Study notes inserted';
}

// Stitches chunks together by concatenation (WebM/Opus chunks play back in sequence in most players);
// for gapless audio keep the per-chunk files, which are stored in the folder as well.
function saveAudioToDrive(id) {
  const meta = JSON.parse(call_('/sessions/' + id).getContentText()).meta;
  const folderName = 'Lecture Scribe' + (meta.course ? ' / ' + meta.course : '');
  const root = DriveApp.getFoldersByName('Lecture Scribe');
  const base = root.hasNext() ? root.next() : DriveApp.createFolder('Lecture Scribe');
  var folder = base;
  if (meta.course) {
    const sub = base.getFoldersByName(meta.course);
    folder = sub.hasNext() ? sub.next() : base.createFolder(meta.course);
  }
  const lec = folder.createFolder(meta.title || id);
  const files = JSON.parse(call_('/sessions/' + id + '/audio').getContentText());
  files.forEach(function (f) {
    const blob = call_('/sessions/' + id + '/audio/' + f.key).getBlob().setName(f.key);
    lec.createFile(blob);
  });
  return files.length + ' audio parts saved to Drive: ' + folderName + ' / ' + (meta.title || id) + ' (' + lec.getUrl() + ')';
}
