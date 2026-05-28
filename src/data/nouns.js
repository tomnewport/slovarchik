// Hand-checked declension tables. Order within each number follows the CASES
// array in lib/declension.js: nom, gen, dat, acc, ins, pre.
//
// Note: animate nouns take the genitive form in the accusative (sg for masc,
// pl for all genders) — see собака / студент below.

export const nouns = [
  {
    id: 'kniga',
    lemma: 'книга',
    en: 'book',
    gender: 'f',
    animate: false,
    forms: {
      singular: { nom: 'книга', gen: 'книги', dat: 'книге', acc: 'книгу', ins: 'книгой', pre: 'книге' },
      plural: { nom: 'книги', gen: 'книг', dat: 'книгам', acc: 'книги', ins: 'книгами', pre: 'книгах' },
    },
  },
  {
    id: 'dom',
    lemma: 'дом',
    en: 'house',
    gender: 'm',
    animate: false,
    forms: {
      singular: { nom: 'дом', gen: 'дома', dat: 'дому', acc: 'дом', ins: 'домом', pre: 'доме' },
      plural: { nom: 'дома', gen: 'домов', dat: 'домам', acc: 'дома', ins: 'домами', pre: 'домах' },
    },
  },
  {
    id: 'more',
    lemma: 'море',
    en: 'sea',
    gender: 'n',
    animate: false,
    forms: {
      singular: { nom: 'море', gen: 'моря', dat: 'морю', acc: 'море', ins: 'морем', pre: 'море' },
      plural: { nom: 'моря', gen: 'морей', dat: 'морям', acc: 'моря', ins: 'морями', pre: 'морях' },
    },
  },
  {
    id: 'sobaka',
    lemma: 'собака',
    en: 'dog',
    gender: 'f',
    animate: true,
    forms: {
      singular: { nom: 'собака', gen: 'собаки', dat: 'собаке', acc: 'собаку', ins: 'собакой', pre: 'собаке' },
      plural: { nom: 'собаки', gen: 'собак', dat: 'собакам', acc: 'собак', ins: 'собаками', pre: 'собаках' },
    },
  },
  {
    id: 'student',
    lemma: 'студент',
    en: 'student',
    gender: 'm',
    animate: true,
    forms: {
      singular: { nom: 'студент', gen: 'студента', dat: 'студенту', acc: 'студента', ins: 'студентом', pre: 'студенте' },
      plural: { nom: 'студенты', gen: 'студентов', dat: 'студентам', acc: 'студентов', ins: 'студентами', pre: 'студентах' },
    },
  },
]
