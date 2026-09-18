// A page is a range of sentence indexes, never a persisted page number. The
// caller measures the actual rendered text at the current width and typeface.

/** @param {number} count @param {number} start @param {(start: number, end: number) => boolean} fits */
export function pageEnd(count, start, fits) {
  if (start >= count) return count
  let low = start + 1
  let high = count + 1
  // One long sentence still gets a page; the page itself can scroll if needed.
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2)
    if (fits(start, mid)) low = mid
    else high = mid
  }
  return low
}

/** Find the fullest preceding page ending at `end`. */
export function pageStart(end, fits) {
  if (end <= 0) return 0
  let low = -1
  let high = end - 1
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2)
    if (fits(mid, end)) high = mid
    else low = mid
  }
  return high
}

/** Retain paragraph boundaries while dividing a book at sentence boundaries. */
export function pageParagraphs(sentences) {
  const paragraphs = []
  for (const sentence of sentences) {
    const last = paragraphs.at(-1)
    if (last?.id === sentence.paragraph) last.sentences.push(sentence)
    else paragraphs.push({ id: sentence.paragraph, sentences: [sentence] })
  }
  return paragraphs
}
