/**
 * Where to go after signing in: only a path on this site. Anything else (another
 * origin, a protocol-relative "//host", the login page itself, an API URL) → "/".
 */
export function safeRedirect(target: string | undefined): string {
  // Control characters are refused outright: browsers drop tabs and newlines from
  // URLs, so "/<tab>/evil.example" would turn into "//evil.example" (another site).
  // eslint-disable-next-line no-control-regex -- control characters are exactly what this strips
  if (!target || /[\u0000-\u001f\u007f]/.test(target)) return '/'
  if (!target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return '/'
  if (target.startsWith('/login') || target.startsWith('/api/')) return '/'
  return target
}
