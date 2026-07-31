# RAIN V6 Beta — Feature Gap Analysis

**Date:** 2026-07-31  
**Scope:** Full source audit of `rain-beta/` repository  
**Methodology:** Read every source file against the documented tech spec, classified implementation completeness on a 5-tier scale.

---

## Classification Scale

| Tier | Label | Definition |
|------|-------|------------|
| 🟢 | **FULLY IMPLEMENTED** | Complete code path from UI → logic → bytes-on-disk/network. No placeholders. |
| 🟡 | **PARTIALLY IMPLEMENTED** | Real code exists but has TODOs, missing endpoints, or env-var gates. |
| 🟠 | **STUBBED** | Type definitions or UI shell exists but no real implementation. |
| 🔵 | **MENTIONED ONLY** | Referenced in comments/docs/plans but zero code exists. |
| ⚪ | **NOT PLANNED** | Never mentioned anywhere in codebase. |

---

## 1. Audio Processing Pipeline (audio-engine.ts)

### Stage 1: Format Normalization
- **🟢 FULLY IMPLEMENTED** — Extracts channel data, forces stereo (mono→stereo duplication). Real DSP.

### Stage 2: Signal Analysis
- **🟢 FULLY IMPLEMENTED** — `analyzeAudio()` via ITU-R BS.1770-4. Real measurements.

### Stage 3: Loudness Measurement
- **🟢 FULLY IMPLEMENTED** — `computeLufs()` + `computeTruePeak()` baseline pass. Real DSP.

### Stage 4: AI Inference (RainNet v2)
- **🟢 FULLY IMPLEMENTED** — ONNX inference path with heuristic fallback (`generateHeuristicParams`). Real model dispatch in `rainnet-inference.ts`.

### Stage 4 (bis): Spectrum & Transients
- **🟢 FULLY IMPLEMENTED** — Real transient density + spectral centroid measurements.

### Stage 5: Genre Profile Match
- **🟢 FULLY IMPLEMENTED** — Reference curve (31-band 1/3-octave biquad) + genre tilt shelf. Real biquad DSP via `designBiquad()`/`applyBiquad()`.

### Stage 6: Spectral Repair
- **🟢 FULLY IMPLEMENTED** — Real HPF + de-ess biquad filtering. Guarded by `macros.repair`.

### Stage 7: BS-RoFormer Source Separation
- **🟢 FULLY IMPLEMENTED** — Real 4-pass cascade (BS-RoFormer → MelBand → Spectral Band-Split → Dereverb). 12-stem output. Capped at ≤60s audio (memory constraint). Falls back gracefully on failure.

### Stage 8: Per-Stem Repair
- **🟢 FULLY IMPLEMENTED** — Real per-category spectral correction (HPF + de-ess + DC verify). Skipped honestly when Stage 7 produces no stems.

### Stage 9: SAIL v2 Per-Stem Processing
- **🟢 FULLY IMPLEMENTED** — Per-stem limiting + gain faders + mute/solo + stereo bus sum. Real DSP via `sailProcessStems()`.

### Stage 10: Master Bus
- **🟢 FULLY IMPLEMENTED** — 8-band parametric EQ + multiband compression + stereo widening (M/S) + groove (transient conditioning) + life (harmonic saturation). All real DSP.

### Stage 11: Loudness Targeting
- **🟢 FULLY IMPLEMENTED** — Real LUFS delta computation + make-up gain. Honest measurement.

### Stage 12: True-Peak Limiting
- **🟢 FULLY IMPLEMENTED** — `applyTruePeakLimiter()` with brickwall ceiling + closed-loop overshoot correction. Real DSP.

### Stage 13: QC Validation
- **🟢 FULLY IMPLEMENTED** — Real final `analyzeAudio()` + re-limit if overshoot. Feeds QC tab metrics.

### Stage 14: Provenance Signing
- **🟢 FULLY IMPLEMENTED** — Stage is a pass-through in the pipeline; real Ed25519 signing happens in `MasteringTab.handleRender()` via `generateProvenance()` which calls `crypto.subtle.sign()`. Chromaprint fingerprinting is real. Output hash computed over Float32 buffer (pre-dither).

### Stage 15: Output Packaging
- **🟢 FULLY IMPLEMENTED** — Real `AudioBuffer` construction via `OfflineAudioContext`. WAV (24/16-bit with TPDF dither) and MP3 (320kbps via LAME with TPDF dither) encoders are fully functional (`audioBufferToWav`, `audioBufferToMp3`). ID3v2 / RIFF INFO tag embedding is real and verified. Ed25519 signature embedding is real. Sidecar `.cert.json` ZIP attachment is real.

### Stage 16: Distribution Ready
- **🟢 FULLY IMPLEMENTED** — Real final QC gate: LUFS delta check + true-peak ceiling verification. Stores real verdict (`_distributionReady`, `_lufsDelta`, `_tpOk`).

### Spatial Processing (processSpatial)
- **🟢 FULLY IMPLEMENTED** — Real HRTF synthesis (Woodworth ITD + head-shadow lowpass + pinna high-shelf + shoulder reflection) via offline `ConvolverNode`. Real M/S stereo enhancement + Haas/allpass upmix to 5.1/7.1/7.1.4. Real ADM BWF XML generation. Real VBAP 3D object panning. Atmos export produces real ZIP with `.atmos.wav` + `audioDefinitionModelBwf.xml` + `spatial.json` + `README.txt` + `MANIFEST.json` (real SHA-256). Preview capped at 60s; full export up to 360s (6 min).

### Repair Pipeline (8 modules)
- **🟢 FULLY IMPLEMENTED** — All 8 modules (`denoise`, `spectral_gate`, `declick`, `decrackle`, `dehum`, `dereverb`, `declip`, `resonance`) have real TypeScript DSP implementations with measurable metrics (noise floor dB, DC offset, clipping count, sibilance dB, rumble dB, phase correlation). Deterministic, abortable, undoable.

---

## 2. The Gap: Audio Processing → Distribution

This is the **critical finding**. The rendering pipeline produces a fully mastered `AudioBuffer` in memory (Stage 15), performs a final QC check (Stage 16), and then... **stops**. The mastering is complete, but nothing automatically ships the master anywhere.

### What exists (fully implemented on the client):
1. **Export formats** — WAV 24-bit, WAV 16-bit, MP3 320kbps, Atmos 7.1.4 ZIP — all render real bytes and trigger browser downloads.
2. **DDEX ERN 4.3.2 XML builder** — `buildDdexErnXml()` produces a valid ERN 4.3.2 `NewReleaseMessage` with ISRC, UPC, AI disclosure fields, DSP `<Deal>` blocks, contributor metadata, territorial codes.
3. **DDEX validator** — `validateDdex()` checks well-formedness, required elements, ISRC format (ISO 3901), UPC check digit.
4. **Distribution package builder** — `buildDistributionPackage()` renders WAV + MP3 from the `AudioBuffer`, validates DDEX XML, computes SHA-256 per asset, builds a PKZIP 2.0 `.zip` with CRC-32 (no external deps).
5. **Artwork validator** — `validateArtwork()` checks JPEG/PNG, square 1:1, 1400-3000px, ≤25MB.
6. **Delivery queue** — IndexedDB-based persistence (`rain-distribution` DB) with `DeliveryJob` state machine: `pending → packaged → submitting → delivered | failed`.
7. **LabelGrid submission** — `submitToLabelGrid()` POSTs multipart/form-data to `/api/rain/distribute`.

### The server-side integration (the actual gap):

| Component | Status | Details |
|-----------|--------|---------|
| `/api/rain/distribute` route | 🟢 FULLY IMPLEMENTED | Real multipart handling, env var gating, forward to LabelGrid. |
| `LABELGRID_API_KEY` env var | 🟡 PARTIALLY IMPLEMENTED | Route code is complete, but the env var is **NOT set** in the default `.env`. The route returns HTTP 409 with `{requiresCredentials: true}` when absent. The UI surfaces this honestly. |
| LabelGrid API endpoint | 🟡 PARTIALLY IMPLEMENTED | Targets `https://api.labelgrid.com/v1/deliveries` — a real URL, but LabelGrid's API is not publicly documented/standardized. The integration assumes a conventional REST shape; if LabelGrid changes, the env var `LABELGRID_API_URL` lets operators override without code changes. |
| Direct platform submission (Spotify, Apple, etc.) | 🔵 MENTIONED ONLY | The DDEX ERN XML includes `<Deal>` blocks per DSP, and `DSP_DELIVERY_PARTNERS` in `constants.ts` lists 40+ platforms. But there is **no code path** that submits directly to any DSP — only to the LabelGrid aggregator. |
| ISO metadata validation (full IPI/ISNI) | 🟡 PARTIALLY IMPLEMENTED | Contributor fields (`ipi`, `isni`) are defined in types and pass-through to DDEX XML, but there is **no validation** that they match ISO standards (no regex format check for IPI/ISNI). |
| UPC/EAN-13 registration | ⚪ NOT PLANNED | `generateUpc()` in `provenance.ts` creates a syntactically valid 12-digit number with correct check digit, but this is a **local identifier only** — not registered with GS1. No mention of GS1 registration anywhere. |
| ISRC code registration | ⚪ NOT PLANNED | `generateIsrc()` creates a syntactically valid ISO 3901 ISRC, but there is **no ISRC registrar integration**. The code is locally generated, not registered with IFPI/national agencies. |
| Multi-track album/EP release | 🟡 PARTIALLY IMPLEMENTED | Types define `TrackMetadata.releaseType` with `'single' | 'ep' | 'album' | 'compilation'`, but the DDEX builder only emits a **single `<SoundRecording>`** — no multi-track support in `buildDdexErnXml()`. The distribution package wraps exactly one WAV + one MP3. |
| Scheduled release dates | ⚪ NOT PLANNED | `releaseDate` is a metadata field passed into DDEX XML, but there is **no scheduler or cron** that would delay delivery until a future date. |
| Bulk distribution / batch submission | ⚪ NOT PLANNED | The delivery queue supports multiple jobs, but each must be submitted manually. No "submit all" or batch delivery flow. |

---

## 3. Tab-by-Tab Analysis

### MasteringTab.tsx
- **🟢 FULLY IMPLEMENTED** — Upload, genre/platform select, macro knobs (7 creative + simple mode), render trigger, A/B compare, blind test, provenance generation, export trigger, analytics persistence. Real state machine: idle → processing → complete/failed.

### DistributeTab.tsx
- **🟢 FULLY IMPLEMENTED** — Full DDEX ERN 4.3.2 pipeline. Handles: metadata entry (title/artist/album/year/ISRC/UPC), AI disclosure (5 fields per EU AI Act §50), artwork upload with validation, platform multi-select (40+ DSPs), DDEX XML live preview, ZIP package build, download trigger, IndexedDB delivery queue with submit/retry/delete per job.
- **⚠️ Gap:** The "Submit" button calls `submitToLabelGrid()` which depends on the server-side `LABELGRID_API_KEY` env var being set. Without it, submission returns `{requiresCredentials: true}` and the UI shows a yellow warning. The package IS built and downloaded; it just isn't delivered.

### ExportTab.tsx
- **🟢 FULLY IMPLEMENTED** — 4 export formats (WAV 24/16, MP3 320, Atmos ZIP). 5 real provenance toggles (cert, signature, fingerprint, metadata tags, sidecar). Real verification report (re-parses exported bytes and confirms toggle compliance). Metadata editor (title, artist, album, track#, year, ISRC, comment). Enterprise-gated full source code ZIP download.

### MetadataTab.tsx
- **🟢 FULLY IMPLEMENTED** — Full `MetadataForm` component (Ditto-standard fields: genre:subgenre, ISRC, UPC, ISWC, release type, label, distributor, P-line, C-line, publisher, PRO, master owner, language, explicit lyrics, parental advisory, territories, contributors with IPI/ISNI/share). Live "Release Card" preview (Spotify-style). Validation feedback.

### ProvenanceTab.tsx
- **🟢 FULLY IMPLEMENTED** — Real Ed25519 verification via `verifyProvenance()` → `crypto.subtle.verify()`. Real Chromaprint fingerprint re-computation and comparison. C2PA v2.2 manifest display. Compliance status grid (EU AI Act, DDEX, C2PA, ISO 3901, ITU-R BS.1770-4, AES17). Audio integrity verification (input/output LUFS, true-peak, duration, sample rate).

### QCTab.tsx
- **🟢 FULLY IMPLEMENTED** — 19-point QC from real signal-domain computations via `computeQCResults()`. 7 category groupings (Loudness, Dynamic, Spectral, Stereo, Transient, Format, Provenance). Async Ed25519 + Chromaprint re-verification. "Re-run QC" button for live remeasurement.

### AnalyticsTab.tsx
- **🟢 FULLY IMPLEMENTED** — KPI cards (renders, audio minutes processed, avg RAIN score, storage). Daily activity bars. RAIN Score history line chart. Per-platform breakdown (bar + table with avg LUFS delta). Per-stage DSP time averages. QC pass/warn/fail rates. Export format distribution. Macro evolution (7-line sparkline, session-only). User activity log with per-type counts. Engine utilization (DSP avg, AI avg, export avg, memory, cumulative DSP, first/last render). "Clear Analytics" button. All data from real IndexedDB or in-memory stores.

### RepairTab.tsx
- **🟢 FULLY IMPLEMENTED** — 8 real DSP modules with before/after metrics. Live per-module progress bars. Apply/undo/reset flow. Real-time repair spectrum analysis (noise floor, DC offset, clipping, sibilance, rumble, phase correlation). Repair macro slider (0-10).

### StemsTab.tsx
- **🟢 FULLY IMPLEMENTED** — AI separation via BS-RoFormer 4-pass cascade. ZIP upload path for pre-separated stems (name-matching against 12 canonical stems). Per-stem mute/solo/gain faders. Per-stem play/stop preview (real playback via `audioEngine.playStem()`). Per-stem WAV download. Real mini-waveform visualization from audio data. Per-stem RMS/PEAK/SRC measurements.

### SpatialTab.tsx (in SecondaryTabs.tsx)
- **🟢 FULLY IMPLEMENTED** — 4 output modes (Stereo/5.1/7.1.4/Binaural). Real HRTF processing. 3D object pad with draggable positioning. Real VBAP gain visualization. Live ADM BWF XML preview. HRTF impulse response sparklines. Play binaural preview. Download BWF or Atmos ZIP. Preview truncated at 60s; full export up to 6 min.

### PitchTab.tsx (in SecondaryTabs.tsx)
- **🟠 STUBBED** — UI controls exist (scale selector, correction strength, retune speed, formant shift) with real sliders and a select dropdown. The pitch curve visualization is **hardcoded SVG points** — not derived from real audio analysis. There is **no DSP implementation** for pitch correction (no CREPE fundamental detection, no PSOLA time-stretch, no formant preservation). The label claims "CREPE fundamental · PSOLA time-stretch · formant preservation" but `grep -r "PSOLA\|psola\|crepe\|CREPE" src/` returns zero results.

### ReferenceTab.tsx (in SecondaryTabs.tsx)
- **🟢 FULLY IMPLEMENTED** — Real 1/3-octave spectral analysis via `computeThirdOctaveSpectrum()`. Real matching curve computation via `computeReferenceMatch()`. The curve is persisted to Zustand and applied in Stage 5 of the render pipeline (31-band biquad peak filter chain). Spectral overlay visualization. Match score display.

### AIETab.tsx (Artist Identity Engine, in SecondaryTabs.tsx)
- **🟢 FULLY IMPLEMENTED** — Real 64-dimensional voice vector computation (32 Mel bands × 2 channels). EMA-based adaptation with cold-start phase. HMAC-SHA256 signed export. Vector visualization (16×4 grid). Session counter + personalization gate (5 sessions). Real `updateVoiceVectorFromBuffer()` + `buildSignedExport()`.

### SettingsTab.tsx (in SecondaryTabs.tsx)
- **🟢 FULLY IMPLEMENTED** — DSP engine checklist (all subsystems verified as "Running"). WASM hash verification toggle. API route listing. About/brand info. HTML5 File System API toggle.

---

## 4. API Routes

| Route | Status | Details |
|-------|--------|---------|
| `/api/rain/distribute` | 🟡 PARTIALLY IMPLEMENTED | Full code; requires `LABELGRID_API_KEY` env var. |
| `/api/rain/render` | 🟢 FULLY IMPLEMENTED | Handles `render_completed` and `export_completed` events. Anonymous + authenticated paths. |
| `/api/rain/session` | 🟢 FULLY IMPLEMENTED | Creates/returns Session rows. |
| `/api/rain/auth/*` | 🟢 FULLY IMPLEMENTED | Register, login, logout, me. Real password hashing + token management. |
| `/api/rain/assist` | 🟢 FULLY IMPLEMENTED | AI Co-Master (LLM-backed). |
| `/api/rain/suggest` | 🟢 FULLY IMPLEMENTED | Mastering report generation. |
| `/api/rain/provenance` | 🟢 FULLY IMPLEMENTED | Cert capabilities endpoint. |
| `/api/rain/feedback` | 🟢 FULLY IMPLEMENTED | User feedback submission. |
| `/api/rain/source` | 🟢 FULLY IMPLEMENTED | Enterprise-gated source ZIP download. |
| `/api/rain/stats` | 🟢 FULLY IMPLEMENTED | Usage statistics. |
| `/api/rain/reviews` | 🟢 FULLY IMPLEMENTED | Public review submission + retrieval. |
| `/api/rain/events` | 🟢 FULLY IMPLEMENTED | Event logging endpoint. |

---

## 5. Database Schema (prisma/schema.prisma)

| Model | Status | Details |
|-------|--------|---------|
| `Account` | 🟢 FULLY IMPLEMENTED | Users with tier (free/enterprise), email, passwordHash, lastActiveAt. |
| `AuthToken` | 🟢 FULLY IMPLEMENTED | Token hashing (SHA-256), expiry, user agent/IP tracking. |
| `Session` | 🟢 FULLY IMPLEMENTED | Mastering sessions with inputFileHash, inputMetadata (JSON), renderSettings (JSON), status state machine (draft/inferring/rendered/archived). |
| `Render` | 🟢 FULLY IMPLEMENTED | Per-export records with format, loudnessLufs, truePeakDbfs, renderTimeMs, outputFileHash. |
| `InferenceJob` | 🟡 PARTIALLY IMPLEMENTED | Schema exists; the RainNet inference runs client-side in audio-engine.ts. The model tracks job status but **no server-side inference workers** exist. The model appears designed for future server-side inference scaling. |
| `Event` | 🟢 FULLY IMPLEMENTED | Append-only analytics log with userId/anonId, event type, JSON metadata. Used by `server-analytics.ts` for funnel math. |
| `Feedback` | 🟢 FULLY IMPLEMENTED | Free-text feedback with optional email + follow-up consent. |
| `Review` | 🟢 FULLY IMPLEMENTED | Public testimonials with approval gating (signed-in auto-approve, anonymous require manual). |

**Missing in schema:**
- ⚪ No `Distribution` or `Delivery` model — delivery jobs are stored client-side in IndexedDB only, not server-side.
- ⚪ No `Release` model — no concept of a multi-track release persisted server-side.
- ⚪ No `Label` or `Artist` model — metadata is transient per-session.

---

## 6. The Critical Gap: End-to-End Distribution

### What the user sees after clicking "Render":

```
Mastering complete → RAIN Score shown → Export tab offers download → 
Distribute tab offers DDEX ZIP package → "Submit" button
```

### What's missing for a real release:

```
┌────────────────────────────────────────────────────────────────────┐
│  1. Audio Processing ✓         → Client-side, done                 │
│  2. WAV/MP3 Export ✓           → Client-side, done                 │
│  3. DDEX ERN XML ✓             → Client-side, done                 │
│  4. Distribution ZIP ✓         → Client-side, done                 │
│  5. LabelGrid API integration ⚠ → Route exists, env key missing    │
│  6. ISRC registration ⚪        → Local generation only, no IFPI    │
│  7. UPC registration ⚪         → Local generation only, no GS1     │
│  8. Multi-track releases ⚪     → Single-track only per the DDEX    │
│  9. Release scheduling ⚪       → No cron/delay mechanism           │
│ 10. Revenue tracking ⚪         → Not mentioned anywhere            │
│ 11. Takedown management ⚪      → Not mentioned anywhere            │
│ 12. Content ID registration ⚪  → Not mentioned anywhere            │
└────────────────────────────────────────────────────────────────────┘
```

### Summary of the "missing middle":

The system goes from **"mastered audio in memory"** to **"ZIP file downloaded to user's machine"**. The distribution layer is implemented as far as **packaging** goes (real DDEX XML, real ZIP, real SHA-256 manifest), but the **delivery** step requires:

1. **A valid `LABELGRID_API_KEY`** in the server `.env` — without it the `/api/rain/distribute` route returns 409.
2. **A LabelGrid account** — and the assumption that LabelGrid's API endpoint accepts the multipart format the route sends.
3. **Manual action** — the user must click "Submit" in the Distribute tab after each package build. There is no "one-click render-to-delivery" flow.
4. **No direct DSP integration** — the system goes through an aggregator (LabelGrid); there is no direct Spotify/Apple/Tidal API integration.

The architecture is correct (render → package → validate → deliver via aggregator), but the **last mile** (env var + actual API response) is gated on operator setup.

---

## 7. Feature Completeness Summary

| Feature Area | Implemented | Partial | Stubbed | Mentioned | Not Planned |
|-------------|:-----------:|:-------:|:-------:|:---------:|:-----------:|
| Audio loading + playback | 🟢 | | | | |
| 16-stage mastering pipeline | 🟢 | | | | |
| 7 creative macros | 🟢 | | | | |
| Simple mode (one-knob) | 🟢 | | | | |
| A/B comparison + blind test | 🟢 | | | | |
| BS-RoFormer stem separation | 🟢 | | | | |
| Per-stem mixing (SAIL v2) | 🟢 | | | | |
| WAV export (24/16-bit) | 🟢 | | | | |
| MP3 export (320kbps LAME) | 🟢 | | | | |
| Atmos export (7.1.4) | 🟢 | | | | |
| Spatial audio engine | 🟢 | | | | |
| RAIN-CERT provenance | 🟢 | | | | |
| Ed25519 signing + verification | 🟢 | | | | |
| Chromaprint fingerprinting | 🟢 | | | | |
| DDEX ERN 4.3.2 XML | 🟢 | | | | |
| Distribution ZIP packaging | 🟢 | | | | |
| Artwork validation | 🟢 | | | | |
| AI disclosure (EU AI Act §50) | 🟢 | | | | |
| Metadata form (Ditto-standard) | 🟢 | | | | |
| QC validation (19-point) | 🟢 | | | | |
| Analytics (IndexedDB) | 🟢 | | | | |
| Repair suite (8 DSP modules) | 🟢 | | | | |
| Reference matching (31-band EQ) | 🟢 | | | | |
| Artist Identity Engine | 🟢 | | | | |
| User auth (register/login) | 🟢 | | | | |
| Server-side event analytics | 🟢 | | | | |
| Review/testimonial system | 🟢 | | | | |
| Pitch correction | | | 🟠 | | |
| LabelGrid delivery | | 🟡 | | | |
| ISRC registration | | | | | ⚪ |
| UPC registration | | | | | ⚪ |
| Multi-track album/EP | | 🟡 | | | |
| Release scheduling | | | | | ⚪ |
| Revenue tracking | | | | | ⚪ |
| Content ID registration | | | | | ⚪ |
| Direct DSP submission | | | | 🔵 | |
| B2B publisher dashboard | | | | | ⚪ |
| Team/collaborator management | | | | | ⚪ |

---

## 8. Key Recommendations

1. **Highest priority — Pitch Correction:** The UI exists but the DSP is hardcoded SVG. Either implement CREPE/PSOLA or remove the tab and label it "Coming in V7."

2. **Medium priority — LabelGrid credential:** Ship the `.env.example` with clear instructions for `LABELGRID_API_KEY` setup. Document the expected LabelGrid API contract. Add a health-check route `/api/rain/distribute/health` that tests connectivity.

3. **Medium priority — Multi-track releases:** The DDEX ERN builder only handles one `<SoundRecording>`. Extend `buildDdexErnXml()` to accept an array of tracks and emit the full ERN 4.3.2 multi-sound-recording structure.

4. **Low priority — ISRC/UPC registration:** These are external services (IFPI, GS1). The library correctly generates valid identifiers but registration requires API integration with national ISRC agencies. Document this as a manual step for now.

5. **Low priority — Direct DSP APIs:** The codebase mentions "LabelGrid" as the sole aggregator. Consider adding a pluggable aggregator interface so operators can swap in their own distribution provider without code changes.

---

*Analysis generated by subagent from full source tree traversal of `rain-beta/` (33 source files reviewed).*
