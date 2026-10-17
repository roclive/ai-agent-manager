Testing & quality pass for the OntoKB video feature.

- Review `kb_source.py`, `kb_video.py`, `kb_autogen.py` and their tests; add missing edge-case tests:
  empty summary, no key_points, very long key_point (wrapping across many lines / font size step-down), mixed
  CJK + latin text, emoji/unsupported glyph handling (must not crash), URL-only summary, Japanese lang.
- Add `tests/conftest.py` fixtures shared across tests (tmp out dir, fake TTS env, tiny size).
- Add a `scripts/kb_smoke.sh` that renders the fixture item at 640x360 with fake TTS and prints the output path
  (used by humans; not part of pytest).
- Fix any bugs you find (small, focused fixes), keep the suite under 60 s.
- Report in your final summary: coverage of each module's public functions, and any known limitations.
