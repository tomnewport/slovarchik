// Nouns for the declension drill, derived from the YAML database.
// Only nouns that carry a declension table are included.
import { byPos } from './db.js'

export const nouns = (byPos.noun ?? [])
  .filter((w) => Object.keys(w.forms).length > 0)
  .map((w) => ({
    id: w.key,
    lemma: w.headword || w.ru, // accented dictionary form for display
    en: w.meaning,
    cefr: w.cefr,
    gender: w.gender,
    animacy: w.animacy,
    animate: w.animate,
    numbers: w.numbers,
    forms: w.forms, // { sg?: {nom,...}, pl?: {...} } with stress marks
  }))
