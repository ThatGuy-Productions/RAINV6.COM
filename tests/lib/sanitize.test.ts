/**
 * RAIN V6 — Sanitization Tests
 *
 * Tests for the input sanitization utilities used to prevent
 * stored XSS attacks on reviews, feedback, and metadata.
 */
import { describe, it, expect } from 'vitest'
import {
  sanitizeText,
  sanitizeReview,
  sanitizeFeedback,
  sanitizeMetadataField,
  hasXssPatterns,
  encodeHtml,
  stripHtml,
} from '@/lib/rain/sanitize'

describe('Input Sanitization', () => {
  describe('encodeHtml', () => {
    it('encodes HTML special characters', () => {
      expect(encodeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;',
      )
    })

    it('preserves normal text', () => {
      expect(encodeHtml('Hello World')).toBe('Hello World')
    })

    it('encodes ampersands', () => {
      expect(encodeHtml('a & b')).toBe('a &amp; b')
    })
  })

  describe('stripHtml', () => {
    it('removes HTML tags', () => {
      expect(stripHtml('<p>Hello</p>')).toBe('Hello')
    })

    it('removes nested tags', () => {
      expect(stripHtml('<div><b>Bold</b> text</div>')).toBe('Bold text')
    })

    it('preserves text content', () => {
      expect(stripHtml('No tags here')).toBe('No tags here')
    })
  })

  describe('hasXssPatterns', () => {
    it('detects script tags', () => {
      expect(hasXssPatterns('<script>alert(1)</script>')).toBe(true)
    })

    it('detects event handlers', () => {
      expect(hasXssPatterns('<img onerror="alert(1)">')).toBe(true)
    })

    it('detects javascript: URLs', () => {
      expect(hasXssPatterns('javascript:alert(1)')).toBe(true)
    })

    it('allows normal text', () => {
      expect(hasXssPatterns('Hello World')).toBe(false)
    })

    it('allows normal URLs', () => {
      expect(hasXssPatterns('https://example.com')).toBe(false)
    })
  })

  describe('sanitizeText', () => {
    it('returns clean text unmodified', () => {
      const result = sanitizeText('Hello World')
      expect(result.sanitized).toBe('Hello World')
      expect(result.wasModified).toBe(false)
      expect(result.rejected).toBe(false)
    })

    it('trims whitespace', () => {
      const result = sanitizeText('  hello  ', { trim: true })
      expect(result.sanitized).toBe('hello')
      expect(result.wasModified).toBe(true)
    })

    it('enforces max length', () => {
      const result = sanitizeText('a'.repeat(100), { maxLength: 10 })
      expect(result.sanitized).toBe('a'.repeat(10))
      expect(result.wasModified).toBe(true)
    })

    it('rejects XSS patterns', () => {
      const result = sanitizeText('<script>alert(1)</script>')
      expect(result.rejected).toBe(true)
      expect(result.reason).toContain('dangerous')
    })

    it('encodes HTML entities', () => {
      const result = sanitizeText('<b>bold</b>', { stripHtml: false, rejectXss: false })
      expect(result.sanitized).toBe('&lt;b&gt;bold&lt;&#x2F;b&gt;')
    })
  })

  describe('sanitizeReview', () => {
    it('enforces 1000 char limit', () => {
      const result = sanitizeReview('a'.repeat(1200))
      expect(result.sanitized.length).toBe(1000)
    })
  })

  describe('sanitizeFeedback', () => {
    it('enforces 2000 char limit', () => {
      const result = sanitizeFeedback('a'.repeat(2500))
      expect(result.sanitized.length).toBe(2000)
    })
  })

  describe('sanitizeMetadataField', () => {
    it('enforces 500 char limit', () => {
      const result = sanitizeMetadataField('a'.repeat(600))
      expect(result.sanitized.length).toBe(500)
    })
  })
})
