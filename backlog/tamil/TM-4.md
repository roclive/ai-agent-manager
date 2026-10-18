Curriculum + lessons, weeks 1–4: reading and writing the script, first 150 words.

Write `tamil/data/curriculum.json` (12-week plan, 5 study days/week × 20 min) and lessons for weeks 1–4 as Markdown in Chinese with a Japanese-comparison box: lesson 1–8 introduce letters in a sensible order (common vowels, then common consonants with
vowel signs, then pulli/joint consonants, then the tricky ழ ள ற ன ண ந distinctions with minimal pairs), each with: new letters (from the alphabet engine, not retyped), reading drills (letter → syllable → word), stroke/writing notes in words, 10 example
words (reviewed:false), quick quiz generated from data. Vocabulary: first 150 high-frequency words (greetings, pronouns, numbers 1–10, family, food, basic verbs) in `tamil/data/vocab_core.json` with Tamil, romanization, Chinese gloss, POS, example, audio id,
`reviewed:false`. `tamil lesson show <n>`, `tamil lesson quiz <n>`. Tests: data schema validation, every word is valid NFC Tamil and romanization matches the translit engine, lesson references only letters that exist, no duplicate ids.
