/**
 * RAIN V6 — DistroKid Browser Automation Delivery Module
 *
 * FREE BETA DISTRIBUTION PATH: When LABELGRID_API_KEY is not configured,
 * this module drives a real browser (Chromium) to auto-upload the mastered
 * release through DistroKid's web upload interface. No API key needed.
 *
 * The user pays for their DistroKid subscription directly (or uses RAIN's
 * bundled tier pricing — see distrokid-pricing.ts). RAIN just automates the
 * upload flow so the user doesn't have to download → re-upload.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️  REQUIRES: npx playwright install chromium
 *    The browser binary (~170 MB) is NOT bundled with RAIN.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Architecture:
 *   Step 1: Navigate to distrokid.com/upload
 *   Step 2: Login (or detect existing session)
 *   Step 3: Select release type (Single/Album/EP)
 *   Step 4: Fill metadata (artist, title, genre, language, ISRC, UPC)
 *   Step 5: Upload mastered WAV file
 *   Step 6: Upload artwork (JPEG/PNG, 3000×3000)
 *   Step 7: Set release date + store selection
 *   Step 8: Confirm + submit
 *   Step 9: Verify "Processing" confirmation page
 *
 * Selectors use semantic attributes (aria-label, placeholder text, text
 * content) to survive DistroKid's frequent UI changes.
 */

import type { BrowserAutomationConfig, BrowserDeliveryResult, BrowserStepResult } from './browser-distribution'

// Re-export types for consumers that import from this module
export type { BrowserAutomationConfig, BrowserDeliveryResult, BrowserStepResult }

// ---------------------------------------------------------------------------
// Step implementations — each returns { ok, error?, screenshot? }
// ---------------------------------------------------------------------------

/** Step 1: Open DistroKid upload page. */
async function stepNavigate(
  page: any,
  _config: BrowserAutomationConfig,
): Promise<BrowserStepResult> {
  const start = Date.now()
  await page.goto('https://distrokid.com/upload', {
    waitUntil: 'networkidle',
    timeout: 30_000,
  })
  // Check we're on the right page
  const title = await page.title()
  if (!title.toLowerCase().includes('distrokid')) {
    return { step: 'navigate', ok: false, durationMs: Date.now() - start, error: `Unexpected page: ${title}` }
  }
  return { step: 'navigate', ok: true, durationMs: Date.now() - start }
}

/** Step 2: Login. If already logged in (session cookie), skip. */
async function stepLogin(
  page: any,
  config: BrowserAutomationConfig,
): Promise<BrowserStepResult> {
  const start = Date.now()
  const step = 'login'

  // Check if already logged in
  const loggedIn = await page.$('text=Upload')
  if (loggedIn) {
    return { step, ok: true, durationMs: Date.now() - start }
  }

  if (!config.credentials?.email || !config.credentials?.password) {
    return {
      step,
      ok: false,
      durationMs: Date.now() - start,
      error: 'DistroKid credentials not provided. Set credentials in config or log in manually.',
    }
  }

  try {
    // Fill email
    await page.fill('input[type="email"], input[name="email"], input[placeholder*="email" i]', config.credentials.email)
    // Fill password
    await page.fill('input[type="password"], input[name="password"]', config.credentials.password)
    // Click login
    await page.click('button[type="submit"], button:has-text("Log In"), button:has-text("Sign In")')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Verify login
    const uploadBtn = await page.$('text=Upload')
    if (!uploadBtn) {
      return { step, ok: false, durationMs: Date.now() - start, error: 'Login appeared to succeed but Upload button not found' }
    }
    return { step, ok: true, durationMs: Date.now() - start }
  } catch (e) {
    return { step, ok: false, durationMs: Date.now() - start, error: `Login failed: ${e instanceof Error ? e.message : 'unknown'}` }
  }
}

/** Step 3: Select release type (Single). */
async function stepSelectType(
  page: any,
  _config: BrowserAutomationConfig,
): Promise<BrowserStepResult> {
  const start = Date.now()
  const step = 'select-type'
  try {
    // Click "Single" — most common release type
    await page.click('button:has-text("Single"), a:has-text("Single"), [aria-label*="Single" i]')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    return { step, ok: true, durationMs: Date.now() - start }
  } catch (e) {
    return { step, ok: false, durationMs: Date.now() - start, error: `Failed to select release type: ${e instanceof Error ? e.message : 'unknown'}` }
  }
}

/** Step 4: Fill metadata form. */
async function stepFillMetadata(
  page: any,
  config: BrowserAutomationConfig,
): Promise<BrowserStepResult> {
  const start = Date.now()
  const step = 'fill-metadata'
  const m = config.metadata
  try {
    // Artist name
    await page.fill('input[name*="artist" i], input[placeholder*="artist" i], input[aria-label*="artist" i]', m.artist)
    await page.waitForTimeout(300)

    // Track title
    await page.fill('input[name*="title" i], input[placeholder*="title" i], input[aria-label*="title" i]', m.title)
    await page.waitForTimeout(300)

    // Genre — try select dropdown first, then text input
    const genreSelect = await page.$('select[name*="genre" i], select[aria-label*="genre" i]')
    if (genreSelect) {
      await genreSelect.selectOption({ label: m.genre })
    } else {
      await page.fill('input[name*="genre" i], input[placeholder*="genre" i]', m.genre)
    }
    await page.waitForTimeout(300)

    // Language
    if (m.language) {
      const langSelect = await page.$('select[name*="language" i]')
      if (langSelect) {
        await langSelect.selectOption(m.language)
      }
    }
    await page.waitForTimeout(300)

    // ISRC
    const isrcInput = await page.$('input[name*="isrc" i], input[placeholder*="ISRC" i]')
    if (isrcInput) {
      await isrcInput.fill(m.isrc)
    } else {
      // Click "I already have an ISRC" radio/button if present
      const haveIsrcBtn = await page.$('text=I already have an ISRC, text=Use my own ISRC')
      if (haveIsrcBtn) await haveIsrcBtn.click()
      await page.waitForTimeout(500)
      const isrcInput2 = await page.$('input[name*="isrc" i], input[placeholder*="ISRC" i]')
      if (isrcInput2) await isrcInput2.fill(m.isrc)
    }
    await page.waitForTimeout(300)

    // UPC
    if (m.upc) {
      const upcInput = await page.$('input[name*="upc" i], input[placeholder*="UPC" i]')
      if (upcInput) await upcInput.fill(m.upc)
    }

    // Explicit lyrics
    if (m.explicitLyrics === 'explicit') {
      const explicitCheck = await page.$('input[type="checkbox"][name*="explicit" i], label:has-text("Explicit")')
      if (explicitCheck) await explicitCheck.click()
    }

    return { step, ok: true, durationMs: Date.now() - start }
  } catch (e) {
    return { step, ok: false, durationMs: Date.now() - start, error: `Failed to fill metadata: ${e instanceof Error ? e.message : 'unknown'}` }
  }
}

/** Step 5: Upload audio file. */
async function stepUploadAudio(
  page: any,
  config: BrowserAutomationConfig,
): Promise<BrowserStepResult> {
  const start = Date.now()
  const step = 'upload-audio'
  try {
    const fileInput = await page.$('input[type="file"][accept*="audio"], input[type="file"][accept*="wav"], input[type="file"]:first-of-type')
    if (!fileInput) {
      return { step, ok: false, durationMs: Date.now() - start, error: 'Could not find audio file upload element' }
    }
    await fileInput.setInputFiles(config.packagePath)
    // Wait for upload to complete (progress bar disappears)
    await page.waitForTimeout(5000)
    // Check for upload error
    const errorText = await page.$('text=error, text=failed, text=invalid file')
    if (errorText) {
      return { step, ok: false, durationMs: Date.now() - start, error: 'Upload failed — file may be invalid format' }
    }
    return { step, ok: true, durationMs: Date.now() - start }
  } catch (e) {
    return { step, ok: false, durationMs: Date.now() - start, error: `Audio upload failed: ${e instanceof Error ? e.message : 'unknown'}` }
  }
}

/** Step 6: Upload artwork. */
async function stepUploadArtwork(
  page: any,
  config: BrowserAutomationConfig,
): Promise<BrowserStepResult> {
  const start = Date.now()
  const step = 'upload-artwork'
  if (!config.metadata.artworkPath) {
    return { step, ok: true, durationMs: Date.now() - start }
  }
  try {
    const fileInput = await page.$('input[type="file"][accept*="image"], input[type="file"]:nth-of-type(2)')
    if (!fileInput) {
      return { step, ok: false, durationMs: Date.now() - start, error: 'Could not find artwork upload element' }
    }
    await fileInput.setInputFiles(config.metadata.artworkPath)
    await page.waitForTimeout(3000)
    return { step, ok: true, durationMs: Date.now() - start }
  } catch (e) {
    return { step, ok: false, durationMs: Date.now() - start, error: `Artwork upload failed: ${e instanceof Error ? e.message : 'unknown'}` }
  }
}

/** Step 7: Set release date + store selection. */
async function stepSetReleaseDate(
  page: any,
  config: BrowserAutomationConfig,
): Promise<BrowserStepResult> {
  const start = Date.now()
  const step = 'release-date'
  try {
    // Set release date — usually a date input
    const dateInput = await page.$('input[type="date"], input[name*="release" i], input[placeholder*="release" i]')
    if (dateInput) {
      await dateInput.fill(config.metadata.releaseDate)
    }
    await page.waitForTimeout(500)

    // Select all stores by default (desired for distribution)
    const selectAllBtn = await page.$('text=Select All, text=All Stores, button:has-text("All")')
    if (selectAllBtn) await selectAllBtn.click()

    return { step, ok: true, durationMs: Date.now() - start }
  } catch (e) {
    return { step, ok: false, durationMs: Date.now() - start, error: `Release date setup failed: ${e instanceof Error ? e.message : 'unknown'}` }
  }
}

/** Step 8: Confirm and submit. */
async function stepConfirm(
  page: any,
  _config: BrowserAutomationConfig,
): Promise<BrowserStepResult> {
  const start = Date.now()
  const step = 'confirm'
  try {
    // Click the final submit/confirm button
    const submitBtn = await page.$('button:has-text("Submit"), button:has-text("Confirm"), button:has-text("Done"), button:has-text("Finish")')
    if (!submitBtn) {
      return { step, ok: false, durationMs: Date.now() - start, error: 'Could not find submit button' }
    }
    await submitBtn.click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)
    return { step, ok: true, durationMs: Date.now() - start }
  } catch (e) {
    return { step, ok: false, durationMs: Date.now() - start, error: `Submit failed: ${e instanceof Error ? e.message : 'unknown'}` }
  }
}

/** Step 9: Verify confirmation page. */
async function stepVerify(
  page: any,
  _config: BrowserAutomationConfig,
): Promise<BrowserStepResult> {
  const start = Date.now()
  const step = 'verify'
  try {
    const confirmationText = await page.textContent('body')
    const isProcessing = confirmationText.toLowerCase().includes('processing')
      || confirmationText.toLowerCase().includes('submitted')
      || confirmationText.toLowerCase().includes('success')
      || confirmationText.toLowerCase().includes('thank you')
      || confirmationText.toLowerCase().includes('your release')

    if (!isProcessing) {
      return { step, ok: false, durationMs: Date.now() - start, error: 'Confirmation page did not contain expected text. Release may not have been submitted.' }
    }
    return { step, ok: true, durationMs: Date.now() - start }
  } catch (e) {
    return { step, ok: false, durationMs: Date.now() - start, error: `Verification failed: ${e instanceof Error ? e.message : 'unknown'}` }
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Deliver a mastered release through DistroKid's web upload interface.
 *
 * This is the FREE BETA distribution path — no API key, no LabelGrid.
 * The user must have a DistroKid account (or use RAIN's bundled tier).
 *
 * @param config — Browser automation config with credentials, package path, metadata.
 * @returns DeliveryResult with per-step status, total duration, and confirmation.
 */
export async function deliverViaDistroKid(
  config: BrowserAutomationConfig,
): Promise<BrowserDeliveryResult> {
  const steps: BrowserStepResult[] = []
  const totalStart = Date.now()
  let page: any = null
  let browser: any = null

  const addStep = (s: BrowserStepResult) => {
    steps.push(s)
    if (!s.ok) {
      console.error(`[DistroKid] Step '${s.step}' failed: ${s.error}`)
    }
  }

  try {
    // Dynamic import — Playwright is ~170 MB and not bundled
    const { chromium } = await import('playwright')

    browser = await chromium.launch({
      headless: config.headless ?? true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })

    page = await context.newPage()

    // Run the step pipeline
    addStep(await stepNavigate(page, config))
    if (!steps[steps.length - 1].ok) throw new Error('Navigation failed')

    addStep(await stepLogin(page, config))
    if (!steps[steps.length - 1].ok) throw new Error('Login failed')

    addStep(await stepSelectType(page, config))
    if (!steps[steps.length - 1].ok) throw new Error('Type selection failed')

    addStep(await stepFillMetadata(page, config))
    if (!steps[steps.length - 1].ok) throw new Error('Metadata fill failed')

    addStep(await stepUploadAudio(page, config))
    if (!steps[steps.length - 1].ok) throw new Error('Audio upload failed')

    addStep(await stepUploadArtwork(page, config))
    if (!steps[steps.length - 1].ok) throw new Error('Artwork upload failed')

    addStep(await stepSetReleaseDate(page, config))
    if (!steps[steps.length - 1].ok) throw new Error('Date setup failed')

    addStep(await stepConfirm(page, config))
    if (!steps[steps.length - 1].ok) throw new Error('Submit failed')

    addStep(await stepVerify(page, config))

    const allOk = steps.every((s) => s.ok)
    return {
      ok: allOk,
      aggregator: 'DistroKid',
      steps,
      totalDurationMs: Date.now() - totalStart,
    }
  } catch (e) {
    return {
      ok: false,
      aggregator: 'DistroKid',
      steps,
      error: e instanceof Error ? e.message : 'Fatal error during browser automation',
      totalDurationMs: Date.now() - totalStart,
    }
  } finally {
    if (page) await page.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
  }
}

/**
 * Check if Playwright + Chromium is available for browser automation.
 * Returns true if `npx playwright install chromium` has been run.
 */
export async function isBrowserAutomationAvailable(): Promise<boolean> {
  try {
    await import('playwright')
    return true
  } catch {
    return false
  }
}

/**
 * Get the recommended distribution method for the current session.
 *
 * Priority:
 *   1. If LABELGRID_API_KEY is set → LabelGrid API (enterprise path)
 *   2. If Playwright is installed → DistroKid browser automation (free beta path)
 *   3. Neither → Download ZIP (manual path)
 */
export type DistributionMethod = 'labelgrid' | 'distrokid_browser' | 'download_only'

export async function getRecommendedDistributionMethod(): Promise<DistributionMethod> {
  // Check LabelGrid API first
  try {
    const resp = await fetch('/api/rain/distribute', { method: 'HEAD' })
    if (resp.ok) return 'labelgrid'
  } catch {
    // API not reachable — fall through
  }

  // Check browser automation
  if (await isBrowserAutomationAvailable()) return 'distrokid_browser'

  return 'download_only'
}