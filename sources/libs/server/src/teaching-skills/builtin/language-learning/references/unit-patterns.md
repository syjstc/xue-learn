# Language unit patterns

## Default communicative sequence

Use this sequence unless the target genuinely makes a step irrelevant:

1. Establish a concrete situation and communicative intention.
2. Give a short natural dialogue or authentic text that covers the unit's main target.
3. Prompt noticing before supplying the explanation.
4. Explain meaning, form, pronunciation, and pragmatics only where relevant.
5. Contrast the target with one or two common incorrect, literal, or less-natural alternatives.
6. Move through controlled production and then guided dialogue.
7. Require a role-play or authentic written response in a meaningfully new situation.
8. Give selective correction and let the learner retry.

Recognition or listening checks can support the sequence, but cannot stand in for speaking or writing when productive ability is the target.

## Existing block grammar

Format the natural dialogue as its own `conversation` block. Keep any setup in the preceding paragraph and analysis in the following paragraph. Use one structured item per turn:

`{"type":"conversation","title":"After a conference","turns":[{"speaker":"A","text":"How was the conference?"},{"speaker":"B","text":"Amazing! Not only did I meet the CEO, but I also presented our project."},{"speaker":"A","text":"Wow! You handled it well."}]}`

Do not place dialogue turns inline inside an explanatory paragraph or callout, and do not use `>` characters as turn separators.

Use the existing material blocks deliberately:

- `conversation`: natural dialogue only; one structured item per speaker turn.
- `stage`: compose ordinary subviews for focused correct/incorrect, literal/natural, form/meaning, or register contrasts.
- `callout`: a compact pronunciation cue, definition, sentence pattern, or high-value pitfall—not a whole dialogue.
- `heading` and `paragraph`: setup, noticing prompts, concise connective explanations, and transitions.
- Server-owned components/checks: bounded recognition and controlled practice.
- Material follow-up: open speaking/writing production, feedback, and retry.

For reading or writing goals, replace spoken role-play with an authentic text response while preserving input, noticing, guided production, independent production, and feedback. Transfer must change the audience, intention, register, or situation rather than restating the model.

## Script-specific scaffolding

- Japanese: annotate learner-facing kanji with furigana in dialogue, examples, and theater choices. Prefer group ruby on words/compounds. Fade annotations as the learner masters common readings; do not replace Japanese text with translation.
- Chinese: use pinyin (or bopomofo for Traditional) ruby on new characters/words the same way — support reading without turning every line into a gloss.
- Korean: use hangul readings for hanja only when hanja appears; otherwise keep hangul as the primary script.
- Alphabetic targets: use IPA sparingly for pronunciation focus, not on every word.

## Scaffolding and correction

For beginners, supply a short sentence frame, word bank, or constrained choice before asking for production. Remove one layer of support at a time as performance becomes more fluent and independent; do not keep the model answer visible during the final transfer.

Correct selectively in this order:

1. Preserve and name what already communicates successfully.
2. Identify the single highest-value form, meaning, pronunciation, or pragmatic pattern.
3. Model a concise, more natural alternative.
4. Ask for another attempt in the same communicative exchange.

Do not turn every response into a full error inventory, and do not let correction end with passive reading of the model answer.
