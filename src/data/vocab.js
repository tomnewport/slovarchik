// Vocabulary list for the translation drill, derived from the YAML database.
// Shape kept stable for VocabView: { id, ru, en[], pos, cefr, note }.
import { words } from './db.js'

export const vocab = words.map((w) => ({
  id: w.key,
  ru: w.headword || w.ru, // accented form for display
  en: w.english, // array of accepted English answers
  pos: w.pos,
  cefr: w.cefr,
  note: w.meaningNote,
}))
