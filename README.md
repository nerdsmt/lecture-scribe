# Lecture Scribe

**Record a lecture, get a private transcript, and turn it into study material with the AI tool you already use.**

Lecture Scribe is a free, open-source, local-first lecture recorder and transcriber for students, in any country and any subject.
A Chrome extension records the audio of a browser tab (Zoom, Teams, Meet, YouTube, recorded lectures) or your microphone
(in-person lectures). A small program on **your own computer** transcribes it with [Whisper](https://github.com/SYSTRAN/faster-whisper).
A library page lets you search, replay and rename your lectures, and a **Study prompts** button builds a ready-to-paste prompt
(summary, quiz, flashcards, practice problems, mock exam...) for Gemini, ChatGPT, Claude or NotebookLM.

## Your recordings stay on your computer

- Audio and transcripts are saved in `local-server/data/` on your machine. The server only listens to your own computer (`127.0.0.1`).
- There is **no account, no cloud service and no tracking**, and nothing is uploaded by default.
- The only network use out of the box is the one-time download of the speech model (from Hugging Face) when you install.
- Optional features (an export folder that Drive/OneDrive/Dropbox syncs, live Google Docs, a Cloudflare deployment) send data to
  services **you** choose, only after **you** set them up. See [PRIVACY.md](PRIVACY.md).
- Pasting a Study prompt into Gemini, ChatGPT, Claude or NotebookLM sends that lecture's text to that service under its own terms. That step is always manual.

Please read [RESPONSIBLE_USE.md](RESPONSIBLE_USE.md) before recording anyone. Lecture Scribe is not affiliated with any university.

## What you need

| | |
|---|---|
| Computer | macOS, Windows or Linux. 8 GB RAM is comfortable; 4 GB works with a small model. About 2 GB of disk for the program and model. |
| Browser | Google Chrome (or a Chromium browser that supports extensions), version 116 or newer |
| Python | 3.10 or newer ([python.org](https://www.python.org/downloads/)). Tested here on 3.13 only. |
| Internet | Only for installing and for the one-time model download |

Status: tested on macOS. The Windows and Linux scripts are written but **not yet tested on real machines**; please report problems.

## Install

### macOS and Linux

```bash
git clone https://github.com/nerdsmt/lecture-scribe.git
cd lecture-scribe
./install.sh
./local-server/start.sh
```

`install.sh` creates a private Python environment, installs the pinned packages, creates `local-server/config.json` with a **random token**, and downloads the speech model.
It prints the token. Keep the Terminal window running while you record.

### Windows

1. Install Python 3.10+ from python.org and tick **Add python.exe to PATH**.
2. Open PowerShell in the project folder and run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```
3. Start the server by double-clicking `local-server\start.bat`. Keep its window open while you record.

### Load the Chrome extension

1. Open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked** and choose the `extension` folder.
2. The Settings page opens by itself. Fill in:
   - **Field of study**, **country or jurisdiction** and **transcript language** (all optional; they tailor the Study prompts and speech recognition).
   - **Server address** (`http://localhost:8787`) and the **token** printed by the server. Press **Test connection**.
   - Click **Grant microphone access** if you will record in-person lectures.
3. Pin the Lecture Scribe icon to the toolbar.

Lost the token? Run `python server.py --show-token` inside `local-server` (use `.venv/bin/python` on macOS/Linux, `.venv\Scripts\python` on Windows).

## Your first recording

1. Start the server (see above).
2. Open the lecture tab (Zoom in the browser, Teams, Meet, YouTube...) or sit in the lecture room.
3. Click the extension icon. Enter a title and course. Optionally add **course terms**: names and jargon the lecturer will use. They improve spelling and are saved for that course.
4. Choose the **audio source**: *Browser tab*, *Microphone*, or both. Click **Start recording**. The first time you will see a short consent reminder.
5. **Pause** and **Resume** whenever you like. Click **Stop recording** when done, and wait a moment while the last parts upload.

Audio is cut into 30 second parts and transcribed as you go. A quiet voice is boosted automatically for recognition only; the saved audio is untouched.
If your computer transcribes slower than real time, the transcript simply finishes a little after the lecture ends.

## Use the library

Click **Open library** in the popup. You can:

- search lecture titles **and** transcript text; click any line to hear that moment (playback speed 0.75x to 2x);
- **Rename** a lecture, download the transcript as Markdown, copy it, or download the whole lecture as one `.m4a`;
- manage **Course terms** (optionally start from a subject preset such as Law, Medicine or Computer Science; presets are only suggestions you can edit);
- delete a lecture (removes its audio, transcript and any exported copy).

## Study prompts (Gemini, ChatGPT, Claude, NotebookLM)

Open a lecture and click **Study prompts**. Choose a study mode and where you will use it, then **Copy prompt** and paste it into the chat.

- Modes: summary and key points, calculation/problem drills, case and scenario practice, mock exam with marking scheme, flashcards (CSV for Anki/Quizlet), multiple-choice quiz, "match my past paper's style", explain the hard parts, coding exercises, vocabulary drills, transcript error check, mark my answer.
- The prompt uses your **field of study** and **country** from Settings. It only mentions law, standards, currency or units when your field uses them. If your field matches a preset, its usual modes are listed first.
- **Gemini / ChatGPT / Claude:** the transcript is included in the prompt. Long lectures are split into parts; paste them one after another.
- **NotebookLM:** the prompt asks it to use one named source instead of embedding the transcript. Add the lecture as a source first, for example by choosing an export folder in Settings that is inside Google Drive and adding the Markdown file from Drive, or by using the library's *Download transcript* and uploading or pasting the text. NotebookLM's supported file types and limits change over time; check its own help if an upload is rejected.
- AI answers can be wrong or invented. Check anything important against the lecture and your course materials.

## Menu-bar app for Mac (optional)

The Chrome extension only records Chrome tabs and the microphone. For Zoom, Teams or any other app, the macOS menu-bar app records **system audio and/or the microphone**:

```bash
cd mac-app && ./build.sh && open LectureScribe.app
```

It needs Xcode's command-line tools (`xcode-select --install`) and macOS 13 or newer. On first start it asks for the server token (or lets you import `local-server/config.json`) and for **Microphone** and **Screen & System Audio Recording** permission in System Settings. Re-grant them after rebuilding. Windows does not have an equivalent yet (see [ROADMAP.md](ROADMAP.md)).

## Settings and the speech model

Server settings live in `local-server/config.json` (created on first run; see `config.example.json`). Environment variables such as `WHISPER_MODEL`, `PORT`, `LECTURE_TOKEN` and `EXPORT_DIR` override it.

`whisper_model` is `"auto"` by default and is chosen from your RAM: under 6 GB `base`, under 16 GB `small`, otherwise `medium`. These are rules of thumb, not benchmarks.

| Model | Download (approx.) | Accuracy | Speed on a CPU |
|---|---|---|---|
| `tiny`, `base` | 75 to 150 MB | Basic; struggles with jargon and accents | Fastest |
| `small` | about 500 MB | Good for clear speech | Fast |
| `medium` | about 1.5 GB | Better with jargon, names and accents | Slower; wants 16 GB RAM |

Bigger is more accurate but slower and hungrier. On a slow laptop, choose a smaller model so the transcript keeps up. If a model is too inaccurate for your lecturer, try the next size up. Other Whisper model names (such as `large-v3-turbo`) work if your installed faster-whisper supports them.

Optional **export folder**: in Settings, pick a detected Google Drive / OneDrive / Dropbox folder or any folder. Transcripts are then also saved there as Markdown. Detection is best-effort and may miss your setup; you can always type a path.

## Optional and advanced features

These are off by default and need your own accounts. No secrets live in this repository.

- **Live Google Docs** writes the transcript into one of your Docs while you record: [docs/OPTIONAL_GOOGLE_DOCS.md](docs/OPTIONAL_GOOGLE_DOCS.md).
- **Cloudflare Worker** is a cloud alternative to the local server (uses Cloudflare Workers AI and costs a little): [docs/OPTIONAL_CLOUDFLARE.md](docs/OPTIONAL_CLOUDFLARE.md). Your audio then goes to Cloudflare. Most students should not need it.
- **Local study notes** (the library's "Local AI notes") need [Ollama](https://ollama.com) installed; they are slow and optional.

## Troubleshooting

| Problem | Try |
|---|---|
| Popup says "Cannot reach the server" | The server is not running. Start `start.sh` or `start.bat` and keep the window open. |
| "Server found, but the token is wrong" | Run `python server.py --show-token` in `local-server` and paste it into Settings. |
| Nothing is transcribed | Check the server window for errors. The first recording after install can be slow while the model loads. |
| Transcript is full of mistakes | Add course terms, set the transcript language instead of `auto`, or use a bigger model. A weak microphone or a distant lecturer is the usual cause. |
| Transcript is slower than the lecture | Use a smaller `whisper_model`. The audio is saved, so it will catch up after you stop. |
| Tab recording captures nothing | Start recording from the tab that plays the audio, with that tab active. Chrome's own pages cannot be captured. |
| Microphone blocked | Settings, then **Grant microphone access**; also check Chrome and OS microphone permissions. |
| Computer went to sleep | The server asks the OS to stay awake. Closing a laptop lid still sleeps it. Plug in the charger for long lectures. |
| Install fails on `av` or `faster-whisper` | The versions are pinned in `local-server/requirements.txt` (`av==15.1.0`: newer releases broke faster-whisper's audio decoding for the author). Check your Python version (3.10+). |
| Changed the server port | Edit `host_permissions` in `extension/manifest.json` to match, reload the extension, and update the address in Settings. |

## Development

```bash
local-server/.venv/bin/python -m unittest discover -s local-server/tests -v   # server tests (no model download)
node --test tests/*.test.js                                                    # prompt builder tests
local-server/.venv/bin/python tests/harness/serve_harness.py                   # browser harness with a stubbed chrome API
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [ROADMAP.md](ROADMAP.md).

## Licence

[MIT](LICENSE). Whisper models and the packages installed by `install.sh` have their own licences. The software is provided as is, without warranty.
