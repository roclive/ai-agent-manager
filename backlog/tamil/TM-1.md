Scaffold + the Tamil alphabet engine (deterministic, Unicode-based).

Generate the complete script programmatically: 12 vowels (உயிர் அ…ஔ), 18 consonants (மெய் க்…ன்), the aytham ஃ, and all 216 vowel-consonant combinations (உயிர்மெய்) built from consonant + vowel sign (U+0BBE… and the pulli rules; note ஔ composes
differently), 247 letters in total, plus grantha letters (ஜ ஷ ஸ ஹ க்ஷ ஸ்ரீ) as a separate set. Each letter record: char, name, romanization (ISO 15919), Chinese pronunciation hint, category (குறில்/நெடில், வல்லினம்/மெல்லினம்/இடையினம்),
articulation place, learning order index, example word placeholder (reviewed:false). `python3 -m tamil alphabet [--chart] [--json]` prints the chart in Chinese; `tamil translit <text> --to roman|tamil` converts both ways for the supported
subset with round-trip tests. Tests with `unicodedata`: counts (12+18+1+216 = 247), every combo is valid NFC and single grapheme, romanization round-trip for all 247, no duplicates.
