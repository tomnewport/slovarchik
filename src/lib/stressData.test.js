// Data-integrity guards for lexical stress (issue #457). Structural tests check
// that a form has the right *letters*; these check that the stress sits on the
// right *syllable* — the class of error that "keeps surfacing" because it's
// valid Cyrillic, just wrong.
//
//   1. No Latin accented vowels / homoglyphs in Russian text. An `á`/`é`/`ó`…
//      (or an ASCII look-alike) pasted into a Cyrillic string renders like a
//      stressed vowel but is the wrong codepoint, so stress-aware matching
//      silently fails on it. This must always be zero.
//
//   2. No *new* wrong-syllable stress in annotated usage phrases. Every token
//      carrying an `inflect:` annotation names its lemma and exact paradigm
//      slot, so the app already knows the one correct stressed form: the word's
//      own stored declension/conjugation cell. A token whose stress disagrees
//      with that cell is either a mis-stressed phrase or a mis-stressed
//      paradigm — the meaning-changing homograph class (сто́ит/стои́т,
//      гóрода/городá). The pre-existing divergences are catalogued in
//      KNOWN_STRESS_DIVERGENCES as a triage backlog; this test fails if any new
//      one appears (so it can't silently regrow) or if a listed one is fixed
//      without pruning the list (so the backlog stays honest).
//
// Run `node scripts/check-stress.mjs` to see the full divergence report.
import { describe, it, expect } from 'vitest'

import { loadFixtureWords, loadFixtureRules } from '../test/fixtures.js'
import { annotatedStressDivergences, latinInRussianText } from './stressAudit.js'

const words = loadFixtureWords()
const rules = loadFixtureRules()

// Pre-existing annotated-token↔paradigm stress divergences (phrase ids), to be
// burned down. Each is a wrong stress on one side or the other; do NOT add to
// this list to silence a new failure — fix the data instead.
const KNOWN_STRESS_DIVERGENCES = new Set([
  'ад=hell#0',
  'багаж=luggage#2',
  'благодарить=to thank#7',
  'браться=to take hold of#2',
  'валить=to topple#2',
  'верх=top#1',
  'верх=top#2',
  'видать=to see#0',
  'видать=to see#1',
  'видать=to see#2',
  'видать=to see#4',
  'возить=to transport#0',
  'вступить=to enter#4',
  'вывести=to lead out#1',
  'вывести=to lead out#3',
  'глубина=depth#2',
  'гражданин=citizen#1',
  'губа=lip#1',
  'даль=distance#2',
  'дар=gift#0',
  'дед=grandfather#2',
  'добавить=to add#0',
  'догадаться=to guess#0',
  'догадаться=to guess#1',
  'догадаться=to guess#2',
  'догадаться=to guess#3',
  'договориться=to agree#5',
  'дождаться=to wait for#3',
  'доходить=to reach#1',
  'доходить=to reach#4',
  'жить=to live#6',
  'зависеть=to depend on#2',
  'зависеть=to depend on#4',
  'задать=to assign#3',
  'задержать=to detain#3',
  'заменить=to replace#4',
  'замереть=to freeze#2',
  'замолчать=to fall silent#4',
  'заповедь=commandment#0',
  'заходить=to drop in#2',
  'заходить=to drop in#5',
  'изменить=to change#0',
  'изменить=to change#5',
  'измениться=to change oneself#0',
  'измениться=to change oneself#2',
  'измениться=to change oneself#4',
  'измениться=to change oneself#5',
  'кедр=cedar#1',
  'кольцо=ring#2',
  'командовать=to command#2',
  'командовать=to command#4',
  'комар=mosquito#2',
  'лебедь=swan#1',
  'медицинский=medical#0',
  'медицинский=medical#1',
  'медицинский=medical#2',
  'миг=instant#2',
  'музей=museum#2',
  'наклониться=to lean#4',
  'налить=to pour#1',
  'намерение=intention#0',
  'находить=to find#4',
  'находиться=to be located#3',
  'находиться=to be located#5',
  'ненависть=hatred#1',
  'обмануть=to deceive#0',
  'обмануть=to deceive#2',
  'обмануть=to deceive#4',
  'означать=to mean#0',
  'означать=to mean#1',
  'означать=to mean#2',
  'означать=to mean#4',
  'осколок=shard#2',
  'остановить=to stop#4',
  'остановиться=to stop#4',
  'отдохнуть=to rest#2',
  'отдохнуть=to rest#4',
  'отказаться=to refuse#0',
  'отходить=to move away#2',
  'отходить=to move away#4',
  'оценить=to evaluate#2',
  'оценить=to evaluate#4',
  'передать=to pass on#2',
  'площадка=platform#0',
  'площадка=platform#1',
  'площадка=platform#2',
  'повар=cook#2',
  'поднять=to lift#3',
  'поднять=to raise#3',
  'подняться=to go up#1',
  'подождать=to wait#2',
  'подпись=signature#2',
  'покачать=to rock#0',
  'покачать=to rock#1',
  'покачать=to rock#2',
  'покачать=to rock#3',
  'покачать=to rock#4',
  'покинуть=to leave#0',
  'полагать=to suppose#0',
  'полагать=to suppose#1',
  'полагать=to suppose#2',
  'полагать=to suppose#4',
  'полагать=to suppose#5',
  'полагаться=to rely on#0',
  'полагаться=to rely on#2',
  'полагаться=to rely on#3',
  'полагаться=to rely on#4',
  'помолчать=to be silent for a while#0',
  'поразить=to strike#0',
  'посадить=to seat#1',
  'посадить=to seat#2',
  'посадить=to seat#3',
  'посидеть=to sit for a while#0',
  'посидеть=to sit for a while#4',
  'постучать=to knock#4',
  'потерять=to lose#3',
  'признать=to acknowledge#4',
  'приказать=to order#0',
  'приказать=to order#4',
  'принц=prince#0',
  'пришить=to sew on#1',
  'психический=mental#0',
  'психический=mental#1',
  'психический=mental#2',
  'развиваться=to develop#0',
  'развиваться=to develop#1',
  'развиваться=to develop#2',
  'развиваться=to develop#4',
  'расположить=to arrange#0',
  'расположить=to arrange#1',
  'расположить=to arrange#2',
  'расположить=to arrange#3',
  'расположить=to arrange#4',
  'рисковать=to risk#5',
  'рог=horn#1',
  'рог=horn#2',
  'родиться=to be born#1',
  'рост=growth#1',
  'светиться=to glow#0',
  'сестра=sister#4',
  'следующий=next#0',
  'следующий=next#1',
  'следующий=next#2',
  'собраться=to gather#0',
  'сорваться=to break free#2',
  'строка=line#0',
  'судья=judge#2',
  'тайна=secret#2',
  'тащить=to drag#0',
  'торопиться=to hurry#6',
  'тёмный=dark#0',
  'убить=to kill#2',
  'усесться=to sit down#1',
  'усесться=to sit down#3',
  'установить=to install#2',
  'утро=morning#3',
  'ухо=ear#0',
  'флирт=flirting#1',
  'хватить=to suffice#1',
  'хранить=to keep#2',
  'художественный=artistic#0',
  'художественный=artistic#1',
  'художественный=artistic#2',
  'час=hour#1',
  'штаб=headquarters#2',
  'шутить=to joke#1',
  'шутить=to joke#5',
  'эксперимент=experiment#2',
  'яхта=yacht#2',
])

describe('stress data integrity', () => {
  it('has no Latin accented vowels / homoglyphs in Russian text', () => {
    const hits = latinInRussianText(words)
    expect(
      hits,
      `Latin letters in Russian text:\n${hits.map((h) => `  [${h.label}] ${JSON.stringify(h.text)}`).join('\n')}`,
    ).toEqual([])
  })

  describe('annotated usage tokens agree on stress with their paradigm', () => {
    const divergences = annotatedStressDivergences(words, rules)
    const byId = new Map(divergences.map((d) => [d.id, d]))

    it('introduces no NEW wrong-syllable stress', () => {
      const added = divergences.filter((d) => !KNOWN_STRESS_DIVERGENCES.has(d.id))
      expect(
        added,
        `New annotated token↔paradigm stress divergence(s) — fix the mis-stressed side:\n${added
          .map((d) => `  [${d.id}] token «${d.token}» vs stored «${d.stored}»  (${d.ru})`)
          .join('\n')}`,
      ).toEqual([])
    })

    it('has no stale baseline entries (prune KNOWN_STRESS_DIVERGENCES when a case is fixed)', () => {
      const stale = [...KNOWN_STRESS_DIVERGENCES].filter((id) => !byId.has(id))
      expect(stale, `Fixed — remove from KNOWN_STRESS_DIVERGENCES:\n${stale.map((id) => `  ${id}`).join('\n')}`).toEqual(
        [],
      )
    })
  })
})
