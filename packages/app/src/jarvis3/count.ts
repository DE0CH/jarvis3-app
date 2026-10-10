/**
 * "1 post", "2 posts", "0 posts": a count with its noun in the right number. `plural` for nouns
 * that don't just add "s".
 */
export function countOf(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}
