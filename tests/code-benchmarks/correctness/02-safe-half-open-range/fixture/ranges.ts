/**
 * Returns items in the half-open range [startIndex, endIndexExclusive).
 */
export function getRange<T>(items: T[], startIndex: number, endIndexExclusive: number): T[] {
  return items.slice(startIndex, endIndexExclusive);
}

/**
 * Splits items into consecutive chunks of at most `size` elements each.
 */
export function chunk<T>(items: T[], size: number): T[][] {
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError(`chunk: size must be a positive finite number, got ${size}`);
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
