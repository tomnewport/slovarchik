// Russian text-to-speech reads an un-dotted initialism like США or СССР as if it
// were a single pronounceable word ("ssha", "sssr") instead of spelling it out.
// Inserting a dot after each letter ("С.Ш.А.") makes the speech engine read the
// letters one by one ("эс-ша-а"), the way a Russian speaker actually says them.
//
// This is a *speech-only* transform: it runs on the text handed to the Web Speech
// API, never on the stored vocabulary. So on-screen spelling and what a learner
// types stay dot-free — the dots exist purely so the audio doesn't sound silly.

// A run of two or more upper-case Cyrillic letters that isn't glued to a
// lower-case Cyrillic letter — i.e. an initialism (США, СССР, ООН), not an
// ordinary capitalised word like "Москва" (one capital + lower-case tail) nor a
// single stand-alone capital like "Я". Latin initialisms are left alone: an
// English voice already spells "TV"/"DIY" out correctly.
const INITIALISM = /(?<![А-ЯЁа-яё])[А-ЯЁ]{2,}(?![А-ЯЁа-яё])/g

/**
 * Dot-separate any Russian initialisms so a speech engine spells them out letter
 * by letter. Returns the input unchanged when there's nothing to do.
 * @param {string} text
 * @returns {string}
 */
export function spellOutInitialisms(text) {
  const str = String(text ?? '')
  if (!str) return str
  return str.replace(INITIALISM, (run) => run.split('').join('.') + '.')
}
