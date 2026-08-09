export function isRichTextEmpty(html: string): boolean {
  if (!html) return true;
  const text = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim();
  if (text.length > 0) return false;
  return !/<(img|table|hr)\b/i.test(html);
}
