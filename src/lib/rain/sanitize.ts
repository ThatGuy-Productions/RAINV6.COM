/**
 * RAIN V6 — Input Sanitization Utilities
 *
 * Server-side sanitization for user-submitted content to prevent
 * stored XSS attacks. Applied to reviews, feedback, comments,
 * metadata text, and release notes.
 */

// ─── HTML Entity Encoding ────────────────────────────────────────────────
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
}

/**
 * Encode HTML special characters to prevent XSS.
 * Preserves Unicode characters (accents, CJK, etc.)
 */
export function encodeHtml(input: string): string {
  return input.replace(/[&<>"'/]/g, (char) => HTML_ENTITIES[char] ?? char)
}

// ─── XSS Pattern Detection ───────────────────────────────────────────────
const XSS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /<script\b/gi,
  /javascript\s*:/gi,
  /vbscript\s*:/gi,
  /on\w+\s*=/gi,           // onclick=, onload=, onerror=, etc.
  /data\s*:\s*text\/html/gi,
  /expression\s*\(/gi,
  /@import\s/gi,
  /<embed\b/gi,
  /<object\b/gi,
  /<iframe\b/gi,
  /<link\b/gi,
  /<meta\b/gi,
  /<base\b/gi,
  /<form\b/gi,
  /<input\b/gi,
  /<textarea\b/gi,
  /<button\b/gi,
  /<svg\b[^>]*\bon\w+/gi,
  /<math\b[^>]*\bon\w+/gi,
]

/**
 * Check if a string contains potential XSS patterns.
 */
export function hasXssPatterns(input: string): boolean {
  return XSS_PATTERNS.some((p) => p.test(input))
}

// ─── Allowed HTML Tags (for rich text fields) ────────────────────────────
// For now, we strip all HTML. If rich text is needed later, we can
// introduce a safelist-based HTML sanitizer.

/**
 * Strip all HTML tags from a string, leaving only text content.
 */
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '')
}

// ─── Sanitization Functions ──────────────────────────────────────────────

export interface SanitizeOptions {
  /** Maximum length in characters (default: 10000) */
  maxLength?: number
  /** Whether to strip HTML tags (default: true) */
  stripHtml?: boolean
  /** Whether to encode HTML entities (default: true) */
  encodeHtml?: boolean
  /** Whether to reject XSS patterns (default: true) */
  rejectXss?: boolean
  /** Trim whitespace (default: true) */
  trim?: boolean
}

export interface SanitizeResult {
  sanitized: string
  wasModified: boolean
  rejected: boolean
  reason?: string
}

/**
 * Sanitize a user-submitted text string.
 *
 * Returns the sanitized string and metadata about what was changed.
 * If `rejected` is true, the input contained XSS patterns and should
 * be rejected entirely (not just cleaned).
 */
export function sanitizeText(
  input: string,
  options: SanitizeOptions = {},
): SanitizeResult {
  const {
    maxLength = 10000,
    stripHtml: shouldStrip = true,
    encodeHtml: shouldEncode = true,
    rejectXss = true,
    trim = true,
  } = options

  let result = input
  let wasModified = false

  // Trim
  if (trim && (result.startsWith(' ') || result.endsWith(' '))) {
    result = result.trim()
    wasModified = true
  }

  // Reject XSS patterns
  if (rejectXss && hasXssPatterns(result)) {
    return {
      sanitized: '',
      wasModified: true,
      rejected: true,
      reason: 'Input contains potentially dangerous content',
    }
  }

  // Strip HTML
  if (shouldStrip) {
    const stripped = stripHtml(result)
    if (stripped !== result) {
      result = stripped
      wasModified = true
    }
  }

  // Encode HTML entities
  if (shouldEncode) {
    const encoded = encodeHtml(result)
    if (encoded !== result) {
      result = encoded
      wasModified = true
    }
  }

  // Enforce max length
  if (result.length > maxLength) {
    result = result.slice(0, maxLength)
    wasModified = true
  }

  return { sanitized: result, wasModified, rejected: false }
}

// ─── Field-specific Sanitizers ───────────────────────────────────────────

/** Sanitize a review/comment body (max 1000 chars) */
export function sanitizeReview(body: string): SanitizeResult {
  return sanitizeText(body, { maxLength: 1000 })
}

/** Sanitize a feedback comment (max 2000 chars) */
export function sanitizeFeedback(comment: string): SanitizeResult {
  return sanitizeText(comment, { maxLength: 2000 })
}

/** Sanitize metadata text fields like title, artist (max 500 chars) */
export function sanitizeMetadataField(text: string): SanitizeResult {
  return sanitizeText(text, { maxLength: 500 })
}

/** Sanitize release notes (max 5000 chars) */
export function sanitizeReleaseNotes(notes: string): SanitizeResult {
  return sanitizeText(notes, { maxLength: 5000 })
}

/** Sanitize a display name (max 100 chars) */
export function sanitizeDisplayName(name: string): SanitizeResult {
  return sanitizeText(name, { maxLength: 100 })
}
