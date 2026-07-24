# Phrase-completion inflection — design & implementation plan

> Status: proposal / not yet built. Owner decision so far: build in two phases;
> phrase-completion **complements** the existing fill-the-table mastery drill
> rather than replacing it.

## Goal

Add a drill where the learner is shown a phrase with one word collapsed to its
dictionary (lemma) form and must produce the correctly **inflected** form
demanded by the surrounding context — e.g. shown `жёлтый` in
"У меня́ есть ___ соба́ка" ("I have a ___ dog"), they must type/assemble
`жёлтая` (feminine nominative).

This is most valuable for **adjectives** (using them in agreement is the hard
part) and **nouns**, and should run as part of **practice sessions** at the
**mastery** tier — not just as the standalone `/phrase-fix` drill it is today.

## Where we are today (what already exists)

| Piece | File | State |
| --- | --- | --- |
| The interaction (blank a slot, type the inflection, lenient grading) | `src/views/PhraseFixView.vue`, `src/lib/phraseFix.js` | **Built, but nouns-only and standalone** |
| Generic paradigm builder (noun / adjective / pronoun / verb → uniform `{rows, cols, cells, stem}`) | `src/lib/paradigm.js` | Built; adjective case×gender grid already produced |
| Usage examples (`usage:` sentences) on words | `public/vocab/{nouns,adjectives}.yml` | 1771 noun + 462 adjective examples |
| Semantic tags (`collections:`) on words | all vocab files | `people`, `work`, `nature`, `animals`, `home`, … — reusable as phrase "families" |
| Practice catalogue → session → exercises | `src/lib/practices.js`, `src/lib/exerciseBuild.js` | Mastery tier currently = `inflect-bank` / `inflect-keyboard` (fill the whole table) |
| Mastery model | `src/lib/progression.js` | Mastery graded on `identification` + `usage` only |

### The three gaps

1. **`phraseFix.js` is noun-only.** It matches phrase tokens against
   `noun.forms`; it ignores adjectives even though `buildParadigm()` already
   produces their full grid.
2. **It's opportunistic, not systematic.** It only fires when a *handwritten*
   usage example happens to contain a non-nominative form of the source word.
   It can never guarantee coverage of a given slot (e.g. `f_ins`, `pl_gen`).
3. **It's outside sessions.** It's a standalone route (`/phrase-fix`, linked
   from Home) and contributes nothing to progression/mastery.

## Core idea: slot-grammar templates

A **template** is a carrier phrase with a single blank, annotated with the
exact grammatical slot the blank requires and the semantic families it suits:

```yaml
# public/vocab/phrase-templates.yml   (new file)
adjective:
  - id: have-pet
    ru: "У меня́ есть ___ соба́ка."     # ___ marks the slot
    en: "I have a ___ dog."
    slot: { gender: f, number: sg, case: nom }
    tags: [animals, character, colour, size]
  - id: live-in-house
    ru: "Мы живём в ___ до́ме."
    en: "We live in a ___ house."
    slot: { gender: m, number: sg, case: pre }
    tags: [home, architecture, size]
noun:
  - id: think-about
    ru: "Я ду́маю о ___."
    en: "I'm thinking about ___."
    slot: { number: sg, case: pre }
    tags: [people, abstract]
```

**Why this is cheap and correct:** the template fixes the carrier noun
(`соба́ка`, feminine) and the syntactic position (`nom`), so the required form
is fully determined. We do **not** need an agreement engine or NLP — we read
the answer straight out of the word's paradigm:

```
жёлтый @ slot{gender:f, number:sg, case:nom}
  → paradigm cell f.nom = жёлтая
  → substitute into "У меня́ есть ___ соба́ка"
  → "У меня́ есть жёлтая соба́ка"   (prompt shows lemma жёлтый; answer = жёлтая)
```

For **nouns**, the slot is just `(number, case)` and the carrier supplies a
preposition/verb that governs that case. Author noun templates **without a
modifier that agrees with the slot noun** (or with a fixed, non-changing one)
so there is no agreement to compute.

### Coverage — can we roll it out to every word being mastered?

Yes, subject to one rule: **every slot we want to test must have at least one
generic, loosely-tagged fallback template**, so no word is ever stranded.

- **Adjectives:** universal — every adjective carries the full case×gender grid,
  so any `(gender, number, case)` slot is answerable.
- **Nouns:** universal per `(number, case)` for any noun with a declension table.
- **Pronouns / verbs:** out of scope for v1 (irregular, agreement-heavy). This
  matches where the pedagogical value is anyway.

Semantic plausibility ("I have a *yellow* dog" ✓ vs "I have a *married* dog" ✗)
is handled by intersecting a template's `tags` with the word's existing
`collections`. Tags are a *nice-to-have* layered on top of the grammatical
guarantee — never a blocker, thanks to the generic fallbacks.

## Plan

### Phase 1 — generalize + wire into sessions (no new data)

Proves the loop end-to-end using the **usage examples we already have**.

1. **`src/lib/phraseFix.js`** — replace the noun-`forms` lookup with
   `buildParadigm(word)` so it finds the inflected token via paradigm cells for
   **any** part of speech (adjectives, pronouns), not just nouns. The returned
   shape (`displayTokens`, `targetIndex`, `lemma`, `answer`, `answerAccented`,
   slot label) stays the same so the existing view keeps working. Extend
   `phraseFix.test.js`.
2. **New mastery practice type** in `src/lib/practices.js`, e.g.
   `inflect-context` (`dimension: 'usage'`, `level: 'mastery'`,
   `content: 'inflection'`). Add it to `SESSION_PRACTICE_FILTERS` (`grammar`
   session + `standard`).
3. **`src/lib/exerciseBuild.js`** — add a `buildContextInflect` branch
   (`PRACTICE_KIND` → new `'phrase-inflect'` kind). For each pooled word it
   picks a usage phrase that yields a `buildFixExercise`, emitting a descriptor
   carrying `targets: [word.key]`, `ru` tokens, `lemma`, `answer`. **Honour the
   existing mastery scoping rule** (see `buildInflect`: `topUpSource = []` at
   mastery so we never record mastery events on out-of-batch words).
4. **Render component** for the session runner: extract the PhraseFixView
   interaction into a small exercise component (sibling of the other
   session-exercise renderers) that the runner mounts for the `phrase-inflect`
   kind. Grade with the existing `normalize()` (stress-insensitive) + `foldYo`
   leniency.
5. **Mastery wiring (complement):** phrase-completion reports to the **usage**
   mastery dimension; the existing `inflect-bank` stays as the **identification**
   mastery practice (recognise the paradigm). Both contribute — no change to
   `progression.js` criteria required, only which practice feeds which
   dimension.

Deliverable: adjectives + pronouns get in-context inflection in sessions,
contributing to usage-mastery, using existing data.

### Phase 2 — the template bank (systematic slot coverage)

Lets mastery probe **every** slot, not only those that appear in handwritten
examples.

1. **`public/vocab/phrase-templates.yml`** — author ~30–60 templates covering
   the gender×number×case combos (adjectives) and number×case combos (nouns) ×
   a few semantic families, each with a generic fallback per slot. Register in
   the `FILES` list in `scripts/gen-manifest.mjs` and document in
   `public/vocab/CONTRIBUTING.md`.
2. **Loading path** — the vocab store's `buildWords` assumes `doc.words`;
   templates are a different shape, so add a small separate load/cache branch in
   `src/stores/vocab.js` + `src/lib/idb.js` (or a `kind: templates` discriminator).
3. **`src/lib/phraseTemplate.js`** (pure, tested) — given a word, its paradigm,
   and a target slot: (a) find templates whose `slot` matches and whose `tags`
   intersect the word's `collections` (fall back to generic templates on no
   match); (b) substitute the paradigm cell into the blank; (c) return the same
   exercise shape `phraseFix` produces, so the Phase 1 renderer/grader are
   reused unchanged.
4. **Exercise builder** — `buildContextInflect` gains a strategy that, for a
   word, chooses target slots (prioritising under-tested ones) and asks
   `phraseTemplate.js` for a phrase, instead of relying on a matching usage
   example. Same descriptor shape, same scoping rules.

Deliverable: mastery systematically rotates through a word's inflection slots
in natural sentences; coverage no longer depends on handwritten examples.

## Testing & conventions

- Keep all logic in framework-free `src/lib/*` modules with co-located
  `*.test.js` (matches the repo's pattern: `phraseFix.test.js`,
  `exerciseBuild.test.js`, `progression.test.js`).
- Grading reuses `normalize()` / `foldYo()` (stress-insensitive, ё/е-lenient) —
  no new leniency rules.
- `npm run lint && npm test && npm run build` before pushing (CI runs all three).

## Open questions (non-blocking)

- Should the standalone `/phrase-fix` route stay as a free-practice entry once
  the session version exists, or be retired in favour of it?
- Do we want a dedicated `phrase_tags:` field later for finer semantic control,
  or are `collections:` good enough? (Start with `collections:`.)
- For Phase 2, how aggressively should mastery insist on covering *all* slots
  vs. a representative sample? (Suggest: a rotating sample, weighted toward
  slots the learner has not yet produced correctly.)
</content>
</invoke>
