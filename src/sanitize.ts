/**
 * Makes server-provided text safe to print: control characters (including terminal escape
 * sequences) become spaces, whitespace runs collapse, and long text is cut with "...".
 */
export function cleanText(value: unknown, maxLength = 200): string {
  const text = typeof value === 'string' ? value : String(value);
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ');
  const trimmed = cleaned.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3)}...` : trimmed;
}

/** The URL as shown in reports: no user name or password, and query values replaced by ***. */
export function displayUrl(url: URL): string {
  const copy = new URL(url.href);
  copy.username = '';
  copy.password = '';
  copy.hash = '';
  if (copy.search !== '') {
    const params = new URLSearchParams();
    for (const key of copy.searchParams.keys()) params.append(key, '***');
    copy.search = params.toString();
  }
  return copy.href;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
