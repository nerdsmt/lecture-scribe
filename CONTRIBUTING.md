# Contributing

Thanks for helping. Lecture Scribe is for students everywhere, so changes that make it work for more people, languages, subjects and computers are especially welcome.

## Principles (please keep them)

1. **Local-first and private.** Nothing may be sent anywhere by default. Anything that uses a network service must be optional, off by default, clearly labelled and documented in [PRIVACY.md](PRIVACY.md).
2. **Free to run.** No required paid service or account.
3. **No personal or institution-specific content.** No school names, course codes, country-specific laws or branding in code or presets. Use the settings (field, country, language) instead.
4. **No secrets in the repo.** Tokens, keys, `config.json`, `courses.json`, `live.json` and `data/` are git-ignored. Never commit recordings or transcripts, not even as test data; tests generate their own audio.
5. **Do not break the HTTP API** used by the extension, the Mac app and the optional Worker (`/sessions`, `/courses`, `/config`, `/health`).

## Layout

- `extension/` Chrome extension (Manifest V3): popup, options, library, study prompts. `presets.js` holds the optional subject presets, `prompt-builder.js` the pure prompt logic.
- `local-server/server.py` the local server (Python, standard library plus `faster-whisper` and `av`).
- `mac-app/` Swift menu-bar app (system audio plus microphone).
- `worker/`, `apps-script/` optional advanced features.
- `tests/`, `local-server/tests/` automated tests and a browser harness.

## Running the tests

```bash
./install.sh                                                                  # once
local-server/.venv/bin/python -m unittest discover -s local-server/tests -v   # server
node --test tests/*.test.js                                                    # prompt builder and presets
local-server/.venv/bin/python tests/harness/serve_harness.py                   # then open http://localhost:8798/library.html
```

The server tests replace transcription with a fake so they run in seconds. `LECTURE_SCRIBE_TEST_WHISPER=1` also runs one test with the real model (downloads the small `tiny` model).

## Adding a subject preset

Edit `extension/presets.js`: copy an entry, give it an `id`, `label`, a few `aliases`, 10 to 20 generic `terms`, the `modes` that suit it (keys of `STUDY_MODES` in `prompt-builder.js`) and a `context` (`law`, `standards`, `currency`, `units`: what a prompt may mention when a country is set). Keep terms generic; no country-specific statute numbers. The tests check that presets are well formed.

## Style

Match the surrounding code: small functions, short comments that explain why, no new dependencies without a reason. Test on more than one OS if you can, and say which in your pull request. Windows and Linux testing is the most useful thing you can offer right now.

By contributing you agree your work is released under the [MIT licence](LICENSE).
