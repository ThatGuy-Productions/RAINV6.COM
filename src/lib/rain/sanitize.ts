/**
 * RAIN V6 — Simple HTML/XSS sanitization utility.
 *
 * Strips dangerous HTML/JS from user-submitted strings to prevent stored XSS.
 * Not a replacement for DOMPurify server-side, but sufficient for:
 *   - Reviews (name, role, title, body)
 *   - Feedback (comment)
 *
 * All inputs are already length-limited by the route handlers; this is a
 * defense-in-depth measure against XSS payloads that slip through.
 */

const XSS_PATTERNS: RegExp[] = [
  // <script>...</script>
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  // Inline event handlers: onerror=, onclick=, onload=, etc.
  /\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
  // javascript: URLs
  /javascript\s*:/gi,
  // data:text/html — can execute scripts
  /data\s*:\s*text\/html/gi,
  // <iframe>...</iframe>
  /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
  // <object>...</object>
  /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi,
  // <embed ... />
  /<embed\b[^>]*\/?>/gi,
  // CSS expression()
  /expression\s*\(/gi,
  // vbscript:
  /vbscript\s*:/gi,
  // <meta http-equiv="refresh" ...>
  /<meta[^>]*http-equiv\s*=\s*["']?refresh/gi,
  // Base64 eval obfuscation: eval(atob(...)) / eval(String.fromCharCode(...))
  /eval\s*\(\s*(?:atob|atou)\s*\(/gi,
  /eval\s*\(\s*[^)]*\bfromCharCode\b/gi,
  // SVG event handlers
  /<svg\b[^>]*\bon\w+\s*=/gi,
  // import() / Function() dynamic code execution in attributes
  /\bimport\s*\(\s*["']/gi,
  /new\s+Function\s*\(/gi,
]

/**
 * Sanitize a string by stripping known XSS vectors.
 * Returns the sanitized string or empty string if input is invalid.
 */
export function sanitizeHtml(input: unknown): string {
  if (typeof input !== 'string') return ''
  let sanitized = input.trim()
  if (!sanitized) return ''

  for (const pattern of XSS_PATTERNS) {
    sanitized = sanitized.replace(pattern, '')
  }

  return sanitized
}

/**
 * Sanitize an optional string value, returning null when the result is empty.
 */
export function sanitizeOptional(input: unknown): string | null {
  const result = sanitizeHtml(input)
  return result || null
}
