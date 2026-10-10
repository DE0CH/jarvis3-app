/** A server timestamp in the viewer's locale (the raw text if it doesn't parse). */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
