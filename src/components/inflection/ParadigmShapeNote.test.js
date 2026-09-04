import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import yaml from 'js-yaml'

import ParadigmShapeNote from './ParadigmShapeNote.vue'
import { buildWords } from '../../lib/vocabBuild.js'
import { buildParadigm } from '../../lib/paradigm.js'

const verbs = `
words:
  "начаться=to begin":
    cefr_level: A1
    accented: нача́ться
    aspect: pf
    pair: "начинаться=to begin"
    en_gb: { standard: to begin }
    conjugation:
      future: { "3sg": начнётся, "3pl": начну́тся }
      past_m: нача́лся
      past_f: начала́сь
      past_n: нача́лось
      past_pl: нача́лись
  "начинаться=to begin":
    cefr_level: A1
    accented: начина́ться
    aspect: impf
    pair: "начаться=to begin"
    en_gb: { standard: to begin }
    conjugation:
      present: { "3sg": начина́ется, "3pl": начина́ются }
      past_m: начина́лся
      past_f: начина́лась
      past_n: начина́лось
      past_pl: начина́лись
  "читать=to read":
    cefr_level: A1
    accented: чита́ть
    aspect: impf
    en_gb: { standard: to read }
    conjugation:
      present:
        "1sg": чита́ю
        "2sg": чита́ешь
        "3sg": чита́ет
        "1pl": чита́ем
        "2pl": чита́ете
        "3pl": чита́ют
      past_m: чита́л
      past_f: чита́ла
      past_n: чита́ло
      past_pl: чита́ли
`

const words = buildWords([{ pos: 'verb', doc: yaml.load(verbs) }])
const paradigmOf = (key) => buildParadigm(words.find((w) => w.key === key))
const render = (key) => mount(ParadigmShapeNote, { props: { paradigm: paradigmOf(key) } })

describe('ParadigmShapeNote', () => {
  it('explains both the missing present and the missing persons of нача́ться', () => {
    const w = render('начаться=to begin')
    expect(w.text()).toMatch(/Why this table is a different shape/)
    expect(w.text()).toMatch(/No present tense/)
    expect(w.text()).toMatch(/Third person only/)
    // The imperfective partner rides in its own Russian-tagged span.
    const ru = w.findAll('[lang="ru"]').map((n) => n.text())
    expect(ru).toEqual(['начина́ться'])
  })

  it('explains only the person axis for the imperfective partner', () => {
    const w = render('начинаться=to begin')
    expect(w.text()).not.toMatch(/No present tense/)
    expect(w.text()).toMatch(/Third person only/)
  })

  it('renders nothing at all for an ordinary table, or with no paradigm', () => {
    expect(render('читать=to read').html()).toBe('<!--v-if-->')
    expect(mount(ParadigmShapeNote, { props: { paradigm: null } }).html()).toBe('<!--v-if-->')
  })
})
