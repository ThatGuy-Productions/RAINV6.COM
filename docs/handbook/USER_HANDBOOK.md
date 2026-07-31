# RAIN V6 Beta — User Handbook

**Version:** Beta Candidate Release 3 | **Date:** 2026-07-31

---

## Welcome

Welcome to RAIN V6 — a professional AI audio mastering engine that runs entirely in your browser. No uploads, no accounts, no cloud servers — your audio never leaves your device.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [The Mastering Interface](#2-the-mastering-interface)
3. [7 Macro Controls](#3-7-macro-controls)
4. [Stem Processing](#4-stem-processing)
5. [Spatial Audio](#5-spatial-audio)
6. [Audio Repair](#6-audio-repair)
7. [Quality Control](#7-quality-control)
8. [Metadata](#8-metadata)
9. [AI Disclosure](#9-ai-disclosure)
10. [Export Options](#10-export-options)
11. [Distribution](#11-distribution)
12. [Provenance & Verification](#12-provenance--verification)
13. [Tips & Tricks](#13-tips--tricks)
14. [Troubleshooting](#14-troubleshooting)
15. [Glossary](#15-glossary)
16. [Support & Community](#16-support--community)
17. [Legal Notice](#17-legal-notice)

---

## 1. Getting Started

### System Requirements

| Component | Minimum | Recommended |
|---|---|---|
| Browser | Chrome 115+, Edge 115+, Firefox 120+ | Chrome 120+ |
| RAM | 8 GB | 16 GB |
| Audio formats | WAV, MP3, FLAC, AIFF, OGG | WAV 24-bit/48 kHz |
| Duration limit | Up to 60 minutes | Up to 10 minutes |
| Internet | Needed for initial load (ONNX models ~66 MB) | No internet needed after load |

### Step 1: Upload Your Audio

1. Open **RAIN V6** (local URL from your admin or the public beta URL)
2. Click the "**Drag & drop or select audio file**" zone
3. Choose an audio file — WAV, MP3, FLAC, AIFF, OGG supported
4. The file auto-analyzes on load — waveform peaks, RMS, and LUFS metrics appear immediately

### Step 2: Choose a Genre

1. Select your **genre** from the dropdown — this influences the entire mastering pipeline (EQ curves, compression characteristics, stereo width)
2. Optional: load a **reference track** (a second audio file for A/B comparison to match tonal balance)

### Step 3: Adjust Macro Controls

Use the 7 macros (detailed in [Section 3](#3-7-macro-controls) below) to shape your overall sound with a single fader — no need to tweak 31 bands of EQ.

### Step 4: Preview or Render

- **Preview**: Hear the effect of any changes you've made (real-time, low latency)
- **Render**: Run the full 16-stage mastering pipeline and produce final 24-bit WAV + 320 kbps MP3 files

---

## 2. The Mastering Interface

The Mastering tab contains, from top to bottom:

1. **Waveform View** — Interactive zoom/pan to inspect the full mix
2. **Frequency Analyzer** — Real-time updating, 31 bands shown
3. **Loudness Indicators** — Short-term and integrated LUFS + true peak dBTP meters
4. **Macro Controls** — 7 faders (see Section 3)
5. **Action Buttons** — Preview / Render / Reset / A/B Compare

### A/B Comparison

- After loading a reference track, the "A" button plays your original audio, "B" the reference
- Both tracks are loudness-matched, so this is a **genuine** tonal comparison
- The "Swap" button in the middle swaps channels (sanity check on stereo preferences)

### Live Preview vs Render

| Feature | Preview (Live) | Render (Offline) |
|---|---|---|
| Latency | ~5ms | 10–60s (duration-dependent) |
| Precision | 32-bit float | 64-bit float internal / 24-bit output |
| Stages | Subset (snapshot) | All 16 stages |
| Export? | No — audible but not saveable | Yes — full WAV + MP3 included |

---

## 3. 7 Macro Controls

Far left (minimum) is minimal processing; center (default 0.5) is "RAIN defaults"; far right (1.0) is maximum.

| Macro | What It Controls | Best For |
|---|---|---|
| **BRIGHTEN** | High-shelf EQ > 4 kHz | Dull recordings — adds air and presence to vocals/cymbals |
| **GLUE** | Bus compression ratio, 10ms attack | "Gluing" a mix together — creating cohesion across elements |
| **WIDTH** | Mid/side difference gain | Narrow for solo instruments (<0.5); wider for EDM/ambient (>0.6) |
| **PUNCH** | Compression attack time, transient shaper | Tightening or loosening drums/percussion — low = more smack |
| **WARMTH** | Odd-order harmonics, tape compression curve | Adding analog "texture" to digital recordings |
| **SPACE** | Reverb send level (from stem separation) | Increasing or reducing processed ambience/room sound |
| **REPAIR** | Intensity of all 8 repair modules | Crank up for noisy phone recordings; keep low for pro studio |

### Macro Combinations: Presets

| Goal | BRIGHTEN | GLUE | WIDTH | PUNCH | WARMTH | SPACE | REPAIR |
|---|---|---|---|---|---|---|---|
| Pop Vocal | 0.60 | 0.55 | 0.3 | 0.45 | 0.40 | 0.2 | 0.10 |
| Amapiano | 0.45 | 0.50 | 0.85 | 0.30 | 0.70 | 0.4 | 0.05 |
| Rock Band | 0.50 | 0.65 | 0.6 | 0.70 | 0.55 | 0.3 | 0.10 |
| Podcast/Voiceover | 0.40 | 0.60 | 0.0 | 0.35 | 0.30 | 0.0 | 0.40 |
| Acoustic Guitar | 0.55 | 0.30 | 0.7 | 0.40 | 0.60 | 0.5 | 0.05 |

---

## 4. Stem Processing

The Stems tab lets you separate your mix into 12 individual stems and process each one independently.

### Stem Separation (BS-RoFormer 4-Pass Cascade)

| Stem Group | What It Contains |
|---|---|
| Lead Vocals | Main singing voice |
| Backing Vocals | Harmonies, backing vocals |
| Kick Drum | Bass drum hits |
| Snare Drum | Snare, claps |
| Hi-hats | Open/closed hi-hats, cymbals |
| Percussion | Congas, shakers, tambourines (non-kit) |
| Bass | Bass guitar, synth bass, 808 |
| Guitar | Electric guitar, acoustic guitar |
| Piano | Acoustic piano, electric piano, organ |
| Ambient | Room reverb, delay tails |
| Dry Other | Synths, strings, claps — everything else |

### Per-Stem Controls

- **Gain fader** (-24 dB to +12 dB) — boost or cut each stem
- **Mute/Solo** — isolate or remove elements
- **Pan** — position stems left/right in the stereo field
- **Limiting** — enable/disable SAIL v2 limiter per stem

### When to Use Stems:

- **Boost vocal presence** → Lead Vocals gain +3 dB, others -2 dB
- **Enhance drums** → Kick +2 dB, Snare +1 dB, PUNCH at 0.6
- **Remove vocals** (instrumental version) → Mute Lead + Backing Vocals
- **Remove drums** (backing track) → Mute Kick, Snare, Hi-hats

---

## 5. Spatial Audio

The Spatial tab transforms your stereo mix into immersive spatial audio.

### Available Spatial Formats

| Format | Channels | Best For |
|---|---|---|
| Stereo Enhanced | 2 | Enhanced stereo width — works on all players |
| Binaural (Headphones) | 2 | 3D audio over headphones — uses HRTF |
| 5.1 Surround | 6 | Home cinema systems |
| 7.1 Surround | 8 | Professional cinema mixes |
| 5.1.2 Dolby Atmos | 8 | Basic Atmos with height channels |
| 7.1.4 Dolby Atmos | 12 | Full Atmos — 4 overhead channels |

### Spatial Modes

- **From Stereo Mix** — Up-mixes 2-channel stereo to selected format (Haas delay + low-pass + all-pass decorrelation)
- **From Stem Mix** — Manually place each stem in 3D space (requires stem separation first)
- **From Ambisonics** — Supports first-order (4ch) or third-order (16ch) AmbiX input

---

## 6. Audio Repair

The Repair tab provides 8 repair modules for cleaning up problem audio. Each module has independent on/off toggles and intensity controls.

| Module | What It Fixes | When To Use |
|---|---|---|
| **De-noise** | Constant hiss, fan noise, tape hiss | Any recording with steady background noise |
| **Spectral Gate** | Low-frequency rumble between passages | Podcasts, voiceover — eliminates "dead air" |
| **De-click** | Digital clicks, pops, buffer errors | Damaged recordings, digital transfer errors |
| **De-crackle** | Vinyl crackle, static interference | Vinyl rips, old recordings |
| **De-hum** | 50/60 Hz mains hum and its harmonics | Recordings with ground loop issues |
| **De-reverb** | Excessive room reverb | Recordings in untreated rooms |
| **De-clip** | Clipping, flat peaks (reconstructs samples) | Overloaded recordings |
| **Resonance Suppression** | Harsh ringing, bell-like resonances | Problem room acoustics — finds peaks and suppresses |

### Processing Order

Repair runs in this order: De-noise → Spectral Gate → De-click → De-crackle → De-hum → De-reverb → De-clip → Resonance Suppression.

Whether repair runs before or after the main mastering depends on your needs:
- **Repair on input** ("Pre-process" enabled) — clean up before mastering — repair stage runs before the main pipeline
- **Repair on output** ("Pre-process" disabled) — fix only the final output — repair stage runs after mastering

---

## 7. Quality Control

The QC tab runs **18 automated checks** and reports issues with your mix.

### QC Thresholds

| Check | Warn Threshold | Fail Threshold |
|---|---|---|
| LUFS (Loudness) | > ±2 LU off target | > ±4 LU off target |
| True Peak | > -1 dBTP | > 0 dBTP |
| Loudness Range (LRA) | > 12 LU | > 18 LU |
| Crest Factor | < 6 dB or > 20 dB | Extremes |
| Stereo Width | < -30 dB (near-mono) | < -50 dB |
| Stereo Correlation | < 0.5 | < 0.0 |
| DC Offset | > -60 dB | > -40 dB |
| Phase Coherence | < 0.7 | < 0.4 |
| Bass Mono (< 200 Hz) | >40% mismatch | > 60% |
| Subsonic Rumble (< 20 Hz) | Present below -40 dB | Present above -20 dB |
| Sibilance (5–8 kHz) | > 12 dB prominence | > 18 dB prominence |
| HF Balance (15+ kHz) | > 12 dB roll-off | > 24 dB roll-off |
| Clipping | Any clip detected | > 5 clip samples |
| Pre-Echo Risk | Moderate risk | High risk |

**Pass > Warn > Fail:** One fail sets QC status to "Fail." Only warns are acceptable — three or more warns triggers "Warn" status.

---

## 8. Metadata

The Metadata tab sets metadata embedded into output files (WAV/MP3) and DDEX distribution packages.

### Field Overview

| Field | Example | Notes |
|---|---|---|
| Track Title | "Summer Rain" | Required |
| Artist | "John Doe" | Required |
| Album | "Seasonal Collection" | Optional |
| Genre | "Amapiano" | Required — pre-filled list from 17 genres |
| Language | "Zulu" | Optional — supports 11 SA languages + 5 global |
| Songwriter | "John Doe" | Optional |
| Producer | "Jane Smith" | Optional |
| Label | "Independent" | Optional |
| BPM | "118" | Optional — auto-detected if left blank |
| Key | "A Minor" | Optional |
| ISRC | "ZA-XXX-26-00001" | ⚠️ RAIN-generated ISRC is a local identifier — not IFPI-registered |
| UPC/EAN | "1234567890123" | ⚠️ RAIN-generated UPC is a local identifier — not GS1-registered |

### Performing Rights Organizations

RAIN V6 includes metadata fields for:
- **SAMRO** — Southern African Music Rights Organisation (SA's main PRO)
- **CAPASSO** — Composers, Authors and Publishers Association (mechanical rights)
- **SAMPRA** — South African Music Performance Rights Association (neighbouring/master rights)

---

## 9. AI Disclosure

Per **EU AI Act Article 50** (effective 2 August 2026), you must declare how **much** AI was involved in creating your audio before distributing it. This is **not** auto-detected — you must actively set each field.

### Per-Field Disclosure Levels

| Field | Options | Meaning |
|---|---|---|
| **Vocals** | None / Assisted / Generated | Real vocals / pitch correction + AI harmonies / Suno-generated vocals |
| **Instrumentation** | None / Assisted / Generated | Real instruments / AI mix suggestions / AI-generated arrangement |
| **Composition** | None / Assisted / Generated | Human-written / AI chord suggestions / AI-generated song structure |
| **Mixing** | None / Assisted / Generated | Manual mix / AI mixing suggestions / AI mixing engine |
| **Mastering** | None / Assisted / Generated | Manual master / AI macros + human review / Full-auto AI mastering |

### Example Scenarios:

- **"I generated a beat on Suno and rapped over it"** →
  Vocals: None | Instrumentation: Generated | Composition: Generated | Mixing: Assisted | Mastering: Assisted
- **"I made everything in Logic Pro, just mastered through RAIN"** →
  Vocals: None | Instrumentation: None | Composition: None | Mixing: None | Mastering: Assisted
- **"Suno generated the entire song, I mastered through RAIN"** →
  All fields: Generated (except Mastering: Assisted)

### Why This Matters

- EU AI Act Article 50 requires **disclosure** of any AI-generated audio that "interacts with human-created content"
- False declarations may carry **legal liability** depending on jurisdiction
- DDEX ERN 4.3.2 embeds these disclosures in the `<AIInvolvement>` block, received by streaming platforms

---

## 10. Export Options

### Formats

| Format | Bit Depth | Sample Rate | File Size (3 min) | Use |
|---|---|---|---|---|
| WAV | 24-bit | 48 kHz | ~52 MB | Archive master, distribution |
| MP3 | 320 kbps | 48 kHz | ~7 MB | Preview, streaming reference |
| FLAC | 24-bit | 48 kHz | ~30 MB | Lossless compressed |
| AIFF | 24-bit | 48 kHz | ~52 MB | Apple ecosystem |
| Dolby Atmos ZIP | 24-bit | 48 kHz | ~100 MB | Spatial audio distribution |

### Dithering

RAIN applies **TPDF** (Triangular Probability Density Function) dithering for the 24-bit output. This replaces quantization distortion with broadband noise that is perceptually transparent.

### Batch Export

Multiple mastering versions (different macro presets) can be rendered in one go, producing optimized versions for different platforms with minimal extra work.

---

## 11. Distribution

### Direct Distribution (DistroKid)

RAIN can automatically upload your mastered audio to the DistroKid distribution platform through browser automation.

**Features:**
- Instant distribution to 150+ streaming platforms (Spotify, Apple Music, TikTok, YouTube Music, etc.)
- Standardized metadata via DDEX ERN 4.3.2 format

**Requirements:**
- **Playwright Chromium** browser installed on your machine

**Pricing (RAIN V6 = DistroKid + 20%):**

| Tier | DistroKid ZAR/yr | RAIN ZAR/yr | Best For |
|---|---|---|---|
| **Musician** | R459.99 | R551.99 | Single artist, basic features |
| **Musician Plus** ⭐ | R826.99 | R992.39 | 2 artists, custom label name |
| **Ultimate** 🏆 | R1,649.00 | R1,978.80 | Up to 100 artists, advanced analytics |

All tiers include: unlimited uploads, 150+ platforms, 100% royalty retention.

**Add-ons (RAIN = DistroKid + 20%):**
| Add-on | Price | Description |
|---|---|---|
| Leave a Legacy | R699 single / R1,199 album | Track stays live forever (even if subscription ends) |
| Store Maximizer | R189/yr/release | Additional distribution platforms |
| YouTube Content ID | R119/yr/single | YouTube copyright detection (excl. 20% YouTube revenue share) |
| Shazam & Siri | R24/yr/release | Shazam identification + Siri integration |

### Manual Distribution

If you prefer not to use DistroKid, you can download the mastered audio and DDEX XML as a ZIP package and upload it manually to your distributor of choice.

### Distribution Checklist

- [ ] ISRC and UPC codes generated by RAIN (or manually entered registered codes)
- [ ] AI disclosure fields set to correct levels
- [ ] QC check passes (no fails, fewer than 3 warns)
- [ ] Metadata fields complete (required: Track Title, Artist, Genre)
- [ ] Cover artwork ready (JPEG/PNG, 3000×3000 pixels)

---

## 12. Provenance & Verification

### RAIN-CERT Certificates

Every time you render audio through RAIN V6, the engine automatically signs a provenance certificate containing:
- SHA-256 hash of the input audio
- Timestamp
- Processing date
- Processing parameters used
- Digital signature (Ed25519)

This provides a verifiable chain-of-custody record for your work.

### How to Verify

**Option 1 — Inside RAIN:**
1. Open both the original and rendered files
2. Go to the "**Provenance**" tab
3. Click "**Verify**" — RAIN will overlay both files and confirm whether they match

**Option 2 — External Verification:**
- Via Ed25519 or C2PA manifest — the certificate and manifest are embedded in the output file's metadata

### What RAIN-CERT Is Not...
- …a substitute for ISRC/UPC registration (ISRC requires IFPI registration, UPC requires GS1)
- …legal copyright registration (requires USCO or local authority)
- …a blockchain record (no cryptocurrency/chain dependency)

---

## 13. Tips & Tricks

### Best Audio Quality:

- Use **WAV 24-bit/48 kHz** as input — avoid MP3 input (already lossy before mastering)
- Keep **peak levels below -6 dB** — leave headroom before mastering
- **Bypass any limiter** on your mix bus before mastering — let RAIN handle it

### Genre Settings:

- **Amapiano** → Automatically increases stereo width + tape saturation
- **Gospel** → Automatically pushes vocals forward + center channel emphasis
- **Podcast** → Disable SPACE + crank REPAIR for room echo
- **Classical** → Disable GLUE + keep WARMTH low = preserve natural dynamics

### Stem Strategies:

- **Isolate vocals for online lessons** → Solo Lead Vocals + mute all others → export only vocals
- **Practice guitar without drums** → Mute Kick, Snare, Hi-hats → export drumless track
- **Remix** → Load two reference tracks → see which should be the model for which stem levels

---

## 14. Troubleshooting

| Problem | Likely Cause | Solution |
|---|---|---|
| App won't load in browser | JavaScript blocked or browser unsupported | Check JavaScript is enabled; use Chrome/Edge/Firefox |
| ONNX model fails to load | Internet connection lost, cache cleared | Refresh page. If persistent, heuristic fallback mode works |
| Render takes very long | Large file (>20 MB) or slow computer | Wait — rendering happens in background. 60s possible for >5 min tracks |
| Stem separation fails to load | Needs GPU support for 12 stems | Falls back to 6 stems (drums, bass, vocals, other). No GPU needed. |
| Export download never starts | Pop-up blocker or storage full | Enable pop-ups; check available disk space |
| Silent or noise-heavy output | Corrupt input file | Try converting to WAV first, then re-upload |
| QC check fails | Input file itself has issues | Use repair modules, or increase QC tolerance |

### Browser Compatibility

| Browser | Status | Notes |
|---|---|---|
| Chrome 115+ | ✅ Fully supported | Recommended |
| Edge 115+ | ✅ Fully supported | Feature-identical to Chrome |
| Firefox 120+ | ✅ Supported | Some features slightly slower |
| Safari 17+ | ⚠️ Limited | Web Audio API restrictions, some features unavailable |
| Brave | ✅ Supported | May need "fingerprint protection" mode enabled |

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **DSP** | Digital Signal Processing — processing audio with math |
| **LUFS** | Loudness Units Full Scale — standard measurement of perceived loudness |
| **dBTP** | Decibels True Peak — absolute maximum signal level accounting for inter-sample peaks |
| **LRA** | Loudness Range — measure of loudness variation in a track |
| **EQ** | Equalization — tone control (low, mid-low, mid-high, high frequencies) |
| **Compressor** | Reduces the difference between loud and quiet parts |
| **Limiter** | A "ceiling" compressor that prevents audio from exceeding a set level |
| **Multiband Compression** | Different compression settings per frequency band |
| **Stereo Width** | Difference between left and right channels |
| **True Peak** | Absolute maximum amplitude of a digital signal (includes inter-sample peaks) |
| **DDEX** | Digital Data Exchange — standard format for music metadata |
| **ISRC** | International Standard Recording Code — unique identifier for a track |
| **UPC/EAN** | Universal Product Code — unique identifier for a release |
| **C2PA** | Coalition for Content Provenance and Authenticity — standard for content authenticity |
| **POPIA** | Protection of Personal Information Act — South Africa's data protection law |
| **SAMRO** | Southern African Music Rights Organisation — SA's performing rights organization |
| **PRO** | Performing Rights Organization — collects and distributes royalties |
| **SAIL v2** | Spectral Adaptive Intelligent Limiter — RAIN's proprietary limiter algorithm |
| **TPDF** | Triangular Probability Density Function — a form of dithering that prevents quantization distortion |
| **HRTF** | Head-Related Transfer Function — simulates how sound reaches the human ear |
| **ADM BWF** | Audio Definition Model Broadcast Wave Format — standard for Dolby Atmos |

---

## 16. Support & Community

### Online Help:
- Documentation: See [README.md](../README.md) and [MASTER_DOSSIER.md](../docs/MASTER_DOSSIER.md)
- Source code: See [GitHub repository](https://github.com/ThatGuy-Productions/RAINV6.COM)

### Feedback:
- Use the in-app **Feedback panel** to report issues or suggest features
- Feedback is entirely optional and contains no personal information

---

## 17. Legal Notice

RAIN V6 is proprietary software by **ThatGuy Productions / ARCOVEL Technologies International**.

### Full Legal Documents:
- [Terms of Service](../docs/legal/TERMS_OF_SERVICE.md) — Service use rules and liability limits
- [Privacy Policy](../docs/legal/PRIVACY_POLICY.md) — How data is collected and processed
- [Data Processing Agreement](../docs/legal/DATA_PROCESSING_AGREEMENT.md) — Data relationship definitions
- [AI Disclosure Compliance](../docs/legal/AI_DISCLOSURE_COMPLIANCE.md) — EU AI Act compliance
- [Payment Terms](../docs/legal/PAYMENT_TERMS.md) — Payment processing and refund policy
- [Liability Waiver](../docs/legal/LIABILITY_WAIVER.md) — AI processing disclaimers

### Important Beta Notice:
- RAIN V6 is in **Beta** — provided "as is" without warranty of any kind
- **All features are free** during Beta (no payment required)
- **Service availability is not guaranteed** during Beta
- **Audio processing happens locally on your device** — no audio is uploaded to our servers
- **No personal data is collected** — no registration, login, or personal information required

---

*Handbook version 1.0-beta · RAIN V6 Beta · © 2026 ThatGuy Productions / ARCOVEL Technologies International*
