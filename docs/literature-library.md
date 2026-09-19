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
| Children’s | Krylov — selected fables | **Available:** complete *Стрекоза и Муравей* |
| Children’s | Pushkin — selected fairy tales | Planned |
| Children’s | Public-domain Russian folk-tale collection | Planned; verify collection editor and edition |
| Beginner | Tolstoy — children’s prose / *Азбука* | **Available:** complete *Муравей и голубка* and *Косточка* |
| Beginner | Chekhov — selected short stories | Planned |
| Beginner | Turgenev — *Муму* | Planned |
| Intermediate | Pushkin — *Капитанская дочка* | Planned |
| Intermediate | Lermontov — *Герой нашего времени* | Planned |
| Intermediate | Turgenev — *Отцы и дети* | Planned |
| Advanced | Dostoevsky — *Преступление и наказание* | Planned |
| Advanced | Gogol — *Мёртвые души* | Planned |
| Advanced | Tolstoy — *Война и мир* | Planned |
| Political | Gorky — *Мать* | Planned; check territory and edition rights |
| Political | Chernyshevsky — *Что делать?* | Planned |
| Political | Lenin — *Государство и революция* | **Available:** chapter I, § 1 selection (19 complete paragraphs); remainder planned |

The downloadable works and their provenance are the JSON files in
`content/books/`. Add another title only after checking the exact source and
every sentence pair. `npm run gen:books` creates the independent packs and
catalog, enforcing data version changes. The library shows only ready packs.
