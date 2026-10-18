Content QA and native-speaker review kit.

`tamil qa` validates every data file: NFC normalization, only Tamil/ASCII punctuation allowed in Tamil fields (no stray Latin/Devanagari), valid grapheme composition (a vowel sign never follows a vowel), romanization ↔ script round trip, no duplicate ids/words,
every audio id resolves, cross-references between lessons/vocab/decks exist, exercises have answers. Output `review/NATIVE_REVIEW.md` (Chinese + Tamil) grouping all `reviewed:false` items by lesson/theme with checkboxes and a column for corrections, and
`tamil review-import corrections.csv` to apply verified corrections (sets `reviewed:true`, records reviewer/date). `tamil qa --stats` shows % reviewed per file. Tests with deliberately broken fixtures for each rule, import idempotence, stats math.
