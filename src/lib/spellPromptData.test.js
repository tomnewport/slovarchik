// Data-integrity guard for English→Russian spelling prompts (issue #527).
//
// A spelling prompt is all the learner gets: gloss, note, part of speech (and,
// for a verb, aspect). If two learnable words render the same three strings for
// two different required answers, the drill is asking a question that cannot be
// answered — the learner guesses. 37 such groups covering 74 words had
// accumulated before this guard existed.
//
// When this fails, fix the *data*, not the test: give the colliding entries
// notes in `en_gb.standard` that actually tell them apart ("(the standard
// word)" vs "(informal)"), the way the 16 synonym groups were fixed. Aspect
// pairs need nothing — the aspect line separates them automatically.
import { describe, it, expect } from 'vitest'

import { loadFixtureWords } from '../test/fixtures.js'
import { shapeVocab } from './vocabBuild.js'
import { duplicateSpellPrompts } from './spellPrompt.js'

const vocab = shapeVocab(loadFixtureWords())

describe('spelling prompts (full corpus)', () => {
  it('covers the lexicon', () => {
    expect(vocab.length).toBeGreaterThan(1000)
  })

  it('never renders the same prompt for two different words', () => {
    const dupes = duplicateSpellPrompts(vocab)
    expect(
      dupes,
      `Spelling prompts that cannot be answered — give these entries distinguishing notes:\n${dupes
        .map((d) => `  ${d.prompt}  →  ${d.ids.join(' / ')}`)
        .join('\n')}`,
    ).toEqual([])
  })
})
