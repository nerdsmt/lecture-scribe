# Roadmap

Rough priorities, not promises. Ideas and pull requests welcome (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## Next
1. **Test on real Windows and Linux machines** (install scripts, start scripts, export-folder detection, keep-awake) and fix what breaks.
2. **Single-installer apps for macOS and Windows** that bundle a speech engine ([whisper.cpp](https://github.com/ggerganov/whisper.cpp) is the candidate) so students do not need Python, a terminal or pip.
3. **Windows system-audio capture** (record Zoom/Teams outside the browser), as the Mac menu-bar app already does on macOS.
4. **Chrome Web Store listing** (needs a privacy policy page, store review and a simple first-run flow that does not need developer mode).

## Later
- Translations of the interface and of the Study prompts.
- Better first-run: a setup wizard that starts the server for you.
- Speaker labels, and slide/screenshot capture alongside the audio.
- Automatic model download choice with a progress bar in the extension.
- More subject presets and study modes contributed by students and teachers.
- Optional encrypted storage of recordings at rest.
- Firefox / Edge support, and a plain-web recorder for phones.

## Known limits today
- The Chrome extension records Chrome tab audio and the microphone only.
- Transcription runs on the CPU; long lectures need patience on slow computers.
- Whisper quality varies with language, accent and microphone.
- Windows and Linux are untested.
