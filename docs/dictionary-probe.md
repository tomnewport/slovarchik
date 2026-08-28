# Dictionary probe — is an external dictionary worth wiring in?

A measurement, not a feature. The question it answers: **would checking the
corpus against an outside dictionary surface real defects, or just noise?**

Run it with:

```bash
npm run probe:dict -- --fetch     # ~22 MB into .dictionary-cache/ (gitignored)
npm run probe:dict                # measure
npm run probe:dict -- --json out.json --samples 40
```

## Why it was worth asking

The corpus carries roughly **46,000 hand-authored inflected forms** — 23,106
noun declension cells, 12,096 adjective cells, 10,498 verb conjugation cells —
and every check we have on them is *internally self-referential*:

- `morphOracle.js` says it in its own header: "if both the table and the drill
  read the same bad source value, CI stays green."
- `stressAudit.js` proof-reads an annotated phrase token against **the word's
  own stored cell** — so a mis-stressed paradigm and a mis-stressed phrase
  agree with each other and pass.
- The only genuinely external ground truth in-repo is the hand-curated golden
  tables: ~66 entries in `morphGolden.js`, ~104 in `stressGolden.js`. Both were
  seeded reactively, one incident at a time.

That is ~170 pinned cells against ~46,000. The oracles are very good at the
error *classes* they have been taught and structurally cannot catch a
plausible-but-wrong form.

## The source, and why not Wiktionary directly

`dumps.wikimedia.org`, `en.wiktionary.org`, `ru.wiktionary.org` and `kaikki.org`
are all refused by the sandbox's egress policy (403 on CONNECT), so the dumps
cannot be fetched from a session. `raw.githubusercontent.com` can, and the
**OpenRussian** dataset ([Badestrand/russian-dictionary][or], CC BY-SA 4.0) is
Wiktionary-derived plus community correction, published as four TSV files whose
schema is a near-exact match for ours:

| ours | theirs |
| --- | --- |
| `sg_nom … sg_ins, sg_pre` | `sg_nom … sg_inst, sg_prep` |
| `conjugation.present/future.1sg…3pl` | `presfut_sg1 … presfut_pl3` |
| `past_m/f/n/pl`, `imperative.sg/pl` | same |
| `declension.m_nom …` (adjectives) | `decl_m_nom …` |
| `gender`, `animacy`, `aspect` | `gender`, `animate`, `aspect` |

They mark stress with an ASCII apostrophe *after* the stressed vowel
(`челове'к`); we use a combining acute *on* it (`челове́к`). `toAcute()` is that
rewrite, and it is the only transformation applied.

**This is a second opinion, not an oracle.** Where the two disagree, either side
can be the wrong one — and their data demonstrably has its own defects (see
below). The licence is CC BY-SA 4.0 against this repo's MIT, which is fine for a
cache we measure against and never ship; it would *not* be fine to paste their
gloss or etymology prose into the YAML.

## Results

### Headword coverage

| pos | words | matched | coverage |
| --- | --- | --- | --- |
| nouns | 2,133 | 2,093 | **98.12%** |
| verbs | 979 | 978 | **99.90%** |
| adjectives | 506 | 502 | **99.21%** |

The 41 misses are almost entirely multi-word entries and recent loans the
dataset predates — `горячий шоколад`, `бизнес-конференция`, `вай-фай`, `ди-джей`,
`имейл`, `дайвинг`. Not a coverage problem for our curriculum.

### Cell agreement

| pos | compared | letters agree | stress agree |
| --- | --- | --- | --- |
| nouns | 11,761 | 99.81% (22 off) | **98.91%** (121 off) |
| verbs | 8,831 | 99.60% (35 off) | **98.75%** (108 off) |
| adjectives | 10,626 | 99.99% (1 off) | **98.92%** (115 off) |

Two noise classes are excluded from those rates, because including them measures
notation rather than language:

- **monosyllables** (648 cells) — they mark `бы́л`, `а́кт`; we correctly leave a
  one-vowel word unmarked, the same rule `stressAudit.js` already applies.
- **sense-doubt words** (181) — where our gloss and their `translations_en`
  share no content word, the entries are probably different senses. `а́тлас`
  "map book" against our `атла́с` "satin" agrees on every letter and disagrees
  on every stress, and is not a corpus bug.

### The residue

**344 stress disagreements over 80 distinct words**, and 58 letter
disagreements. That is small enough to read by hand — which is the whole point.

Adjudicating a sample of it (**my reading; it wants a second pair of eyes before
any of it is applied**):

| verdict | examples |
| --- | --- |
| **ours is wrong** | `академик` → акаде́мик · `варежка` → ва́режка · `супермаркет` → суперма́ркет · `представитель` → представи́тель · `четверть` gen → че́тверти · `орудие` → ору́дие · `хлопок`=cotton → хлопо́к (we have the *clap* stress on the *cotton* gloss) · `виноватый` → винова́тый · `неожиданный` → неожи́данный · `служебный` → служе́бный · `характерный` → характе́рный · `заявить` 2sg → зая́вишь · `научить` → нау́чишь · `создать` 1pl → создади́м · `зависеть` 1sg → зави́шу · `изображать` 1sg → изобража́ю (ours `изображаю́` is not a possible Russian stress) |
| **theirs is wrong** | `гражданин` (ours гражда́нин is right) · `волна` · `контроль` gen · `пропадать` 1sg · `происходить` 3sg · `уголь` ins (ours углём is right) |
| **different sense, not a defect** | `атлас`=satin · `ирис`=toffee · `видение`=apparition · `сведение`=information · `парить`=to soar |
| **genuine variation, both correct** | `махать` маха́ю/машу́ (already allowlisted in `morphGolden.js`) · `двигаться` дви́гаюсь/дви́жусь · `ехать` поезжа́й/езжа́й · `родиться` роди́лись/родили́сь |
| **their data is corrupt** | `дождаться` → `дождала́ю́сь` · `двойка` → `двоек` in the nominative · `фронт` → `фро́нта́` (two marks) · `скачать` → `скачáю` with a **Latin á** — the exact homoglyph contamination `stressAudit.js` check #1 hunts for, in their file |

Roughly **half** the residue looks like a real corpus defect, and the adjective
findings are the most valuable per unit of effort: five wrong lemma stresses,
each propagated mechanically through all 23 generated cells, which is 115 of the
344 findings from five one-line fixes.

### Two systematic classes worth a decision, not a fix

- **The second locative.** 8 nouns where our `sg_pre` is the plain prepositional
  and theirs is the locative: `в аэропорту́`, `в году́`, `на полу́`, `в полку́`,
  `в порту́`, `в пруду́`, `в ряду́`, `на балу́`. Both forms are real and mean
  different things. The corpus has no slot for the locative at all, so this is a
  curriculum gap rather than a wrong cell.
- **Animacy-driven accusative.** 24 noun animacy disagreements, several
  propagating into `sg_acc` (`дух`, `насекомое`, `спутник`, `член`, `участок`).
  Mixed: `кукла` is grammatically animate and we mark it inanimate; `близнецы`,
  `ветеран`, `генерал` we have right and they have wrong.

## Recommendation

Worth building on, with the shape the repo already uses twice:

1. Keep it a **worklist**, like `translationAudit.js` — never a CI gate. Half
   the residue is legitimate, a threshold over it would be noise, and the
   dictionary is not authoritative enough to fail a build on.
2. Record adjudications durably the way `review/confusables-reviewed.jsonl`
   does for sound-alikes, so a rejected finding stays rejected and each run
   shows only what is new.
3. **Promote, don't depend.** As findings are confirmed, write the corrected
   form into `stressGolden.js` / `morphGolden.js` — which *are* CI guards. The
   dictionary becomes a bulk generator of golden entries, CI stays offline and
   deterministic, and the CC BY-SA surface stays inside a gitignored cache.

Not useful for: CEFR levels, gloss choice, `en_gb` phrasing, the 16,173 example
sentences. The translation review stays a human reading pass.

Related: #600 (sentence tokens contradicting the dictionary) is the phrase-side
half of the same problem.

[or]: https://github.com/Badestrand/russian-dictionary
