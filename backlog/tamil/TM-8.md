Offline static web app.

`tamil web build [--out web_out]` generates a self-contained static site (HTML/CSS/vanilla JS, no CDN, Chinese UI, dark mode, mobile friendly) from the data files and the audio manifest: letter chart with tap-to-play sounds, flashcard trainer (local SRS state in
localStorage, try/catch), lesson viewer, vocabulary browser with search, Tamil-keyboard-free input via romanization. `tamil web serve` serves it on 127.0.0.1:8790. Audio copied/linked only if present; graceful when missing. Tests: build output contains all pages and
assets, no external URLs, JSON data embedded validates, JS syntax check with `node --check` on the generated script (node is available), SRS JS scheduler unit test through node.
