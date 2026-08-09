/**
 * Normalize a user-provided URL string.
 *
 * - Trims whitespace
 * - Prepends `https://` when no protocol is present
 * - Validates via the WHATWG URL constructor (only http/https allowed)
 *
 * @returns The normalised URL string, or `null` if the input is invalid.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let raw = trimmed;
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}
