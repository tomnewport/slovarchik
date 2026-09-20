# Literature library selection

The first downloadable set is a short, complete reading path: one verse fable
by Krylov and two pieces of Tolstoy's *First Russian Book for Reading*. These
exercise verse layout, narration, dialogue, offline installation and one new
English translation per stable Russian unit. Each pack names its exact source
revision and text rights. The original works are public domain; the Wikisource
transcriptions carry attribution and share-alike terms.

The fifteen candidate slots from #761 are a selection queue. **Planned** means
the exact edition, redistribution rights, text and full English translation
still need review. It is not an empty downloadable book. Large novels may be
separate, clearly labelled selections with their own IDs and versions.

| Shelf | Candidate | Status |
| --- | --- | --- |
| Children’s | Krylov — selected fables | **Available:** complete *Стрекоза и Муравей*; further fables queued |
| Children’s | Pushkin — selected fairy tales | Planned; *Сказка о рыбаке и рыбке* first |
| Children’s | Mayakovsky — *Что такое хорошо и что такое плохо?* (1925) | Planned; rights clear on all three tests |
| Children’s | Sasha Chorny — *Детский остров* (1921) | Planned; rights clear on all three tests |
| Children’s | Public-domain Russian folk-tale collection | **Available:** Afanasyev, *Народные русские сказки* (1855–63) — complete *Репка* (no. 89); further tales queued |
| Beginner | Tolstoy — children’s prose / *Азбука* | **Available:** complete *Муравей и голубка* and *Косточка* |
| Beginner | Chekhov — selected short stories | Planned |
| Beginner | Turgenev — *Муму* | Planned |
| Intermediate | Pushkin — *Капитанская дочка* | Planned |
| Intermediate | Lermontov — *Герой нашего времени* | Planned |
| Intermediate | Turgenev — *Отцы и дети* | Planned |
| Advanced | Dostoevsky — *Преступление и наказание* | Planned |
| Advanced | Gogol — *Мёртвые души* | Planned |
| Advanced | Tolstoy — *Война и мир* | Planned |
| Political | Gorky — *Мать* | Planned; rights checked — Gorky died 1936 (Russian term ran out in 2007) and the novel was published 1906–07, so it is out of US copyright too |
| Political | Chernyshevsky — *Что делать?* | Planned |
| Political | Lenin — *Государство и революция* | **Available:** chapter I, § 1 selection (19 complete paragraphs); remainder planned |

## Which works may ship

A pack downloads to a learner anywhere, so a title ships only when the
underlying Russian work is out of copyright under **all three** of:

1. **Russia**, its source country — life + 70 (Art. 1281), plus the four-year
   extension for an author who lived through the Great Patriotic War, and, for a
   repressed author posthumously rehabilitated, a term running from the
   rehabilitation rather than the death.
2. **The United States**, where the pages are served — for a Soviet work this
   usually means the URAA rule of 95 years from publication, because works still
   in copyright in Russia on 1 January 1996 were restored. Anything published
   before 1931 is out regardless.
3. **The EU and the UK**, where many learners are — life + 70.

Russia alone is not enough: Gaidar and Alexei Tolstoy are out of copyright at
home while the United States still protects them. The English is ours to
license; the Russian is not, so no amount of new translation work makes a
protected text shippable, and neither does a link — pointing readers at an
infringing copy is not a way round the rule.

These dates are a maintainer's reading of the statutes, recorded so the next
person can check the reasoning rather than repeat it. They are not legal advice.

### Not available, and when that changes

| Work | Free when | Why |
| --- | --- | --- |
| Marshak — children's verse | 1 Jan 2039 | Died 1964; life + 70 plus the wartime extension. Russian Wikisource holds no texts for the same reason |
| Oseeva — *Васёк Трубачёв и его товарищи* | 1 Jan 2040, or 2044 | Died 1969; the wartime extension would add four years. Published 1947–51, so no publication-date argument helps |
| Gaidar — *Чук и Гек*, *Тимур и его команда* | 2035 in the US | Out of copyright in Russia; restored in the US, where the term is 95 years from publication |
| Alexei Tolstoy — *Золотой ключик* | 2031 in the US | As above; published 1936 |

The downloadable works and their provenance are the JSON files in
`content/books/`. Add another title only after checking the exact source and
every sentence pair. `npm run gen:books` creates the independent packs and
catalog, enforcing data version changes. The library shows only ready packs.
