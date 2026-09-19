/**
 * Returns the 1-indexed page of `items` for a given page size.
 */
export function getPage<T>(items: T[], pageNumber: number, pageSize: number): T[] {
  const start = (pageNumber - 1) * pageSize;
  const end = start + pageSize;
  return items.slice(start, end + 1);
}
