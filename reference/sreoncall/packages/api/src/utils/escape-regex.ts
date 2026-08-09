/**
 * Escapes special regex characters in a string to prevent ReDoS attacks.
 * Use before passing user input to `new RegExp()`.
 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
