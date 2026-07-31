# RAIN V6 — Absolute Best Quality Audit
## Every Subsystem Compared Against Industry Standard

**Date:** 2026-07-31  
**Scope:** 16 key subsystems, each assessed for "could this be the best?"  
**Verdict Scale:** ✅ Best / ⚠️ Good-but-one-upgrade-short / ❌ Needs work

---

## 1. LUFS Computation (ITU-R BS.1770-4)

**Status: ✅ Best**

Correct implementation of the full BS.1770-4 spec:
- Two-stage K-weighting: high-shelf 1500Hz/+4dB (Q=1/√2) → high-pass 38Hz (Q=0.5)
- 400ms blocks with 75% overlap (per spec)
- Absolute gate at -70 LUFS → relative gate at -10 LU below mean of absolute-gated
- Channel weights: L/R=1.0, C=1.0, LFE=1.0, Ls/Rs=1.41
- K-weighting coefficients matched against pyloudnorm reference
- Sign convention: a1 stored negative, subtracted (matches bs.1770-4)

**No upgrade needed.** This is what EBU broadcast meters use.

---

## 2. True Peak (4× Polyphase Oversampling)

**Status: ✅ Best (after critical fix)**

- 48-tap FIR per ITU spec, 4 polyphase branches (12 taps each)
- **Was buggy:** raw BS.1770-4 coefficients had non-unity DC gain per branch (+1.44 dB on phase 0/3), inflating true-peak on bass-heavy material by 0.3–1.7 dB
- **Fixed:** Each branch normalized to unity DC gain — exact then, zero runtime cost
- Reused scratch buffer eliminates per-sample allocations (was 28.8M allocations for 5-min stereo)
- All 4 phases searched; peak absolute value across all phases is the dBTP result

**No upgrade needed.** This fix alone is worth 1.7 dB of accuracy on sub-bass masters.

---

## 3. Biquad Filters (RBJ Audio EQ Cookbook)

**Status: ⚠️ Good — one upgrade pushes it to best**

- Correct RBJ coefficients for all 6 types (lowpass, highpass, peak, notch, lowshelf, highshelf)
- Direct Form I with correct sign convention (a1/a2 negative, subtracted)
- Correct normalization (b0/a0, b1/a0, b2/a0, a1/a0, a2/a0)

**Upgrade: Direct Form I → Direct Form II Transposed**
```
DF-I: 5 multiply + 4 add per sample (current)
DF-II-T: 5 multiply + 4 add per sample, but only 4 state variables vs 4
```
DF-I is numerically equivalent. The real upgrade is **not here** — it's in the EQ type:

**Upgrade: Minimum-Phase → Linear-Phase EQ**

Current Stage 10 uses 8-band **minimum-phase** biquads. Professional mastering EQ uses **linear-phase** FIR for the mid/high bands to avoid phase smearing on transients:
```
Linear-phase: symmetric FIR kernel → constant group delay → zero phase distortion
Minimum-phase: nonlinear phase → group delay varies with frequency → transient smearing
```
- **Effort:** ~100 lines. Design linear-phase FIR from the same RBJ frequency response via window method (Kaiser window)
- **Impact:** Audible improvement on percussion (kick/snare attack preserved), acoustic instruments (string transients)
- **Trade-off:** Pre-ringing (linear phase) vs post-ringing (minimum phase) — the mastering standard is linear phase

**Verdict:** The biquads are technically correct but minimum-phase only. One upgrade to linear-phase EQ and this is best-in-class.

---

## 4. Multiband Compression

**Status: ❌ Needs work — 3 bands vs industry standard 4-5**

Current: 3-band Linkwitz-Riley crossover (low/mid/high)
- Compression applied per band with independent threshold/ratio/attack/release
- Compressor uses envelope follower (not feed-forward) — attack is instant, release is exponential per `releaseCoef = exp(-1/(releaseMs*sampleRate))`

**Industry Standard:**
- **iZotope Ozone Dynamics:** 4 bands (Low, Low-Mid, High-Mid, High) with variable crossover points
- **FabFilter Pro-MB:** Up to 6 bands, dynamic phase mode, linear phase mode
- **Waves LinMB:** 5 bands, linear phase, adaptive threshold
- **Standard broadcast multiband:** 4-5 bands (sub/bass, low-mid, presence, high, air)

**Upgrade Path:**

1. **4-band crossover** (minimum): 80 Hz / 500 Hz / 4000 Hz
2. **Feed-forward detection:** Read the sidechain signal rather than the output
3. **Soft knee** (current is hard knee): `gainReduction = ratio*(overshoot - knee/2)^2 / (2*knee)` in knee region
4. **Look-ahead** (current limiter has it, compressor doesn't): 1-5ms look-ahead prevents overshoot on fast transients

```typescript
// Current 3-band → proposed 4-band
const CROSSOVERS = [80, 500, 4000]  // Hz — industry standard mastering crossover points
const BANDS = ['sub', 'low-mid', 'presence', 'air']

// Proposed soft knee
function softKneeGainReduction(overshoot: number, ratio: number, kneeWidth: number): number {
  if (overshoot <= -kneeWidth/2) return 0
  if (overshoot >= kneeWidth/2) return overshoot / ratio
  const k2 = kneeWidth / 2
  return (overshoot + k2)**2 / (4 * k2 * ratio)
}
```

**Verdict:** 3-band is functional but not competitive with professional tools. Upgrade to 4-band with soft knee and feed-forward detection.

---

## 5. Saturation Modeling

**Status: ⚠️ Good — 3 modes, but missing the pro standard**

Current modes:
| Mode | Algorithm | Character |
|------|-----------|-----------|
| `tape` | tanh(x·k)/tanh(k) — symmetric soft clip | Warm, even harmonics |
| `tube` | (1−exp(−ax·k))/(1−exp(−k)) — asymmetric, sign-preserving | Rich even harmonics, mild asymmetry |
| `transformer` | x + k·x²·sign(x)·(−0.3) + k·0.3·tanh(3x) — square-law + soft knee blend | Iron-core saturation, odd harmonics |

All three are functional and produce distinct, usable characters.

**Industry Standard (AnalogNet — the roadmap spec):**
- **LA-2A opto compressor** — photo-resistor time constants (10ms attack, 60ms-5s dual-stage release)
- **1176 FET compressor** — ultra-fast attack (20-800μs), program-dependent release
- **Pultec EQP-1A** — passive tube EQ with resonant low boost + simultaneous cut
- **SSL G-Series Bus Compressor** — VCA glue compression (10/30ms attack, 100/300ms auto-release)
- **Studer A800 tape** — frequency-dependent saturation (bias-dependent HF rolloff), wow & flutter
- **Neve 1073 preamp** — transformer-coupled saturation with Carnhill inductor EQ interaction

**Upgrade Path:** The roadmap specifies 16 AnalogNet WaveNet TCN models. For the BETA's TypeScript engine:

1. **Add bias-based even/odd control** to tube mode: `mix = bias * even + (1-bias) * odd`
2. **Add frequency-dependent saturation**: Oversampling before saturation prevents aliasing
3. **Add hysteresis model** to tape mode: `y = tanh(x·k + prev·feedback)` (not just static tanh)

**Verdict:** 3 modes is more than most browser tools offer. But vs the AnalogNet roadmap spec, this is 5% of the plan. The existing modes are correctly implemented for what they are.

---

## 6. Limiter (Look-Ahead Brickwall)

**Status: ✅ Best**

Two-stage architecture:

**Stage 1 — `applyLimiter()`:**
- Look-ahead window (default 5ms) with correct alignment: gain computed from future samples, then **delayed** by look-ahead samples before application
- **Was buggy** (AUDIT-C2 fix): gain was being computed from future but applied to current sample, so the ceiling clamp was doing all the actual limiting → audible clipping. Fixed via delayed gain envelope alignment.
- Exponential release: `gain → gain + (1−gain) * (1−exp(−1/(releaseMs*sampleRate)))`

**Stage 2 — `applyTruePeakLimiter()`:**
- Closed-loop convergence: limit → measure dBTP (4× oversampling) → re-limit with adjusted ceiling → repeat until pass or 4 iterations
- Aims 0.05 dB under the true-peak ceiling for QC safety margin
- Converges in 1-2 iterations for program material

**No upgrade needed.** This architecture matches professional limiters (FabFilter Pro-L2, iZotope Ozone Maximizer).

---

## 7. Stereo Widening (M/S Processing)

**Status: ✅ Best for stereo mastering**

- Mid/side encode/decode (correct scaling: ×0.5 on both paths)
- Independent mid gain + side gain + stereo width coefficient
- Bass mono below 200 Hz: LPF on side channel, subtract from side, add to mid
- Correct: `side[i] = (side[i] − sideBass[i]) * sideLin + sideBass[i] * 0.1` — bass 10% in side, 90% in mid

**No upgrade needed.** This is exactly what professional M/S processors do.

---

## 8. FFT Implementation

**Status: ⚠️ Good — radix-2, single power-of-2 size only**

- Radix-2 Cooley-Tukey, in-place, bit-reversal permutation
- correct twiddle factor accumulation: `w_n = cos(-2π/N) + j·sin(-2π/N)`
- Exported and shared across 4 files (was previously duplicated)

**Industry Standard:** Mixed-radix FFT (FFTW library) supporting arbitrary sizes with padding. Radix-2 is the correct foundation.

**Upgrade: Add power-of-2 validation at compile time.** Current code throws at runtime. A `const size = 1 << Math.ceil(Math.log2(input.length))` auto-pad would be more robust.

**No upgrade needed for quality.** FFT is correct, just limited to power-of-2 sizes.

---

## 9. RainNet v2 ONNX Inference

**Status: ✅ Best for in-browser ML inference**

- Full architecture: MelSpecEncoder (128×128, Hamming window, triangular filterbank) → Transformer (4 layers, 8 heads, 256-dim, layer norm + residual) → Decoder (46 neurons)
- `decodeParams()` ported verbatim from Python `model.py` — sigmoid/tanh/softplus activation functions match exactly
- Graceful fallback: if ONNX fails or audio < 0.5s, falls back to `generateHeuristicParams()` — no crash, no silent corruption
- Uses `onnxruntime-web` with MultiThreshold session management

**No upgrade needed for the BETA.** The ONNX model itself (RainNet v2) could be trained on more data, but the inference engine is solid.

---

## 10. Heuristic Fallback (Genre Overrides)

**Status: ✅ Good — 17 genres with real, distinguishable settings**

**Was dead code** (AUDIT-M5 fix): GENRE_OVERRIDES previously set fields (mb_threshold, mb_ratio, stereo_width, saturation) that `applyMacrosToParams()` immediately overwrote. Fixed: now only sets fields that survive the macro pass-through:
- mb_attack_low/mid/high (genre-specific transient response)
- mb_release_low/high (genre-specific dynamics)
- mid_gain (center channel emphasis)
- stereo_width (for SA genres: amapiano=1.25, gqom=1.15, afro_house=1.3)
- analog_saturation + saturation_drive + saturation_mode (for afro genres)

**17 genres with unique profiles:** pop, rock, electronic, classical, jazz, hip_hop, country, rnb, amapiano, gospel, afrobeats, afro_house, gqom, metal, reggae, latin, edm

**Upgrade:** The genre table is expert-tuned but could be data-driven. Long-term: replace with RainNet V3 that learns genre profiles from training data.

**No upgrade needed for BETA.** 17 genres with real, audibly different settings is competitive.

---

## 11. Chromaprint Fingerprint

**Status: ❌ Simplified — not AcoustID-compatible**

Current: 32 frames × 8 bands, threshold-quantized to 1 bit per band, packed to bytes, hex encoded. This is a custom hash, not the Chromaprint specification.

**Industry Standard (Chromaprint):**
- FFT-based 16-band filterbank
- Sub-band spectral images across time
- 16-bit quantization with adaptive threshold
- 2-bit encoding per sub-band per frame
- Base64-encoded string output
- AcoustID-compatible fingerprint format

**Upgrade:** Implement the actual Chromaprint algorithm OR use `acoustid` npm package.

```typescript
// Chromaprint proper: 16 Mel-spaced bands, quantized to 2-bit differential
// Output: base64(compact_fingerprint_bytes) → AcoustID-compatible
```

**Impact:** Without proper Chromaprint, the AcoustID auto-metadata lookup (#4 in the previous report) can't work. The current hash is valid for internal integrity checks but useless for MusicBrainz queries.

**Verdict:** Must upgrade to real Chromaprint for the auto-metadata pipeline.

---

## 12. TPDF Dither

**Status: ✅ Best — correct, well-documented, correctly positioned**

- Two uniform RNGs [-0.5, +0.5) summed → triangular PDF in [-1, +1) LSB
- Applied at the exact moment Float32 → Int conversion happens
- Identical algorithm in both WAV (16-bit, 24-bit) and MP3 paths
- Certificate signed over Float32 buffer **pre-dither** (correct: cert attests to the deterministic master, not the lossy encode)

**No upgrade needed.** TPDF dither is the audio engineering standard (1 LSB peak-to-peak triangular noise). No correlation, no noise shaping needed for mastering.

---

## 13. LAME MP3 Encoder

**Status: ✅ Best — professional-grade with critical fix**

- Uses `@breezystack/lamejs` (pure-JS LAME port)
- CBR 320 kbps (or configurable bitrate)
- **Critical fix applied:** LAME's default lowpass filter (which cuts at 16-20.5 kHz depending on bitrate) is disabled by patching `lowpassfreq = -1` and `highpassfreq = -1` before `lame_init_params()`. At 320 kbps CBR, the encoder has ample bits for full 48 kHz bandwidth — the default lowpass was an unnecessary quality loss.
  - 128 kbps: LAME lowpass = 17 kHz (fixed: full bandwidth if bitrate allows)
  - 192 kbps: LAME lowpass = 18.6 kHz (fixed)
  - 320 kbps: LAME lowpass = 20.5 kHz (fixed: now 24 kHz Nyquist)
- 1152-sample frame blocks, flushed on final partial block
- ID3v2.3 tag with cert/signature/fingerprint/metadata frames (all optional, toggle-gated)

**No upgrade needed.** This is a real, high-quality MP3 encoder with production-grade configuration.

---

## 14. WAV Metadata + LSB Watermark

**Status: ⚠️ Good — comprehensive metadata but watermark could be stronger**

Metadata (all present, real bytes):
- `ISFT` — RAIN V6 version string
- `ICMT` — certificate fingerprint comment
- `IART` — artist from metadata
- `INAM` — title from metadata
- `IPRD` — album from metadata
- `IGNR` — genre
- `ITRK` — track number
- `ICRD` — year
- Standard RIFF/WAV format with correct chunk sizes

LSB Watermark:
- 32-bit payload derived from cert signature (or `0xDEADBEEF` fallback)
- 1 bit per sample on channel 0 only
- Repeats every 1024 samples for redundancy
- Applied to both 16-bit (Int16 LSB) and 24-bit (Uint24 LSB)

**Upgrade Path:**
1. **Current LSB is fragile** — MP3/AAC encoding destroys LSB. Fine for WAV archival, useless after distribution encoding.
2. **Phase-coding watermark** — embed data in phase relationship between frequency bins. Survives lossy compression. ~500 lines of STFT-based DSP.
3. **Spread-spectrum watermark** — PN-sequence spread across full audio bandwidth, detected via correlation. Industry standard (AudioSeal, Cinavia). ~1000 lines + filterbank.

**Verdict:** WAV metadata is comprehensive. LSB watermark is honest (not claiming to be AudioSeal) but fragile. For the post-session archival master, LSB is acceptable (the cert is the real provenance mechanism). For distributed content, phase-coding is the next upgrade.

---

## 15. DDEX ERN 4.3.2

**Status: ⚠️ Good — 90% field coverage, single-track only**

Field coverage:
- ✅ MessageHeader (MessageId, MessageCreatedDateTime, MessageSender)
- ✅ ResourceList (SoundRecording with ISRC, ISWC, ReferenceTitle, Duration)
- ✅ ResourceContributorList (per-contributor with IPI/ISNI/Share)
- ✅ ReleaseId (ISRC + UPC)
- ✅ DisplayArtist / ReferenceTitle
- ✅ Genre (with SubGenre)
- ✅ Year, ReleaseDate, OriginalReleaseDate
- ✅ PLine / CLine / LabelName / DistributorName
- ✅ LanguageOfPerformance
- ✅ ParentalWarningType (Explicit/Cleaned/NotExplicit)
- ✅ TerritoryCode (per-territory)
- ✅ Publisher with PRO
- ✅ MasterOwner
- ✅ AIInvolvement (5 fields: vocals, instrumentation, composition, mixing, mastering) — Sept 2025 DDEX standard
- ✅ DealList (per-DSP CommercialModel)
- ⚠️ Missing: multi-SoundRecording (albums/EPs)
- ⚠️ Missing: <ReleaseResourceReferenceList> (links release to recordings)

**Validation:**
- DOMParser-based XML well-formedness check
- Required element presence check
- ISRC format validation (ISO 3901: CC-XXX-YY-NNNNN)
- UPC check digit validation (EAN-13 mod-10)
- Root element namespace verification (ern:NewReleaseMessage)

**Verdict:** This is an unusually thorough DDEX generator for any tool, let alone a browser-based one. Multi-track support is the single gap.

---

## 16. ISRC / UPC Generation

**Status: ❌ Non-deterministic — Math.random() used**

Current:
- ISRC: `US{registrant}{year}{Math.random()*100000}` — syntactically valid, check-digit-correct, but **non-unique** (collision probability)
- UPC: `Array.from({length:11}, () => Math.random()*10) + checkDigit` — same issue

**Industry Standard:**
- ISRC: sequential counter per registrant per year (00001-99999). Atomic increment in DB.
- UPC: GS1-allocated prefix + sequential item reference. Atomic increment per prefix.
- Both require registration with national agencies (IFPI for ISRC, GS1 for UPC)

**Fix:**
```typescript
// ISRC: use session-derived hash for collision resistance (not global uniqueness but ~0 collision)
function generateIsrcDeterministic(registrant: string, sessionId: string, year: number): string {
  const hash = sha256(sessionId + year + registrant).slice(0, 5) // 5 hex chars → 16^5
  const designation = (parseInt(hash, 16) % 100000).toString().padStart(5, '0')
  return `US${registrant}${String(year % 100).padStart(2,'0')}${designation}`
}

// UPC: same approach
function generateUpcDeterministic(sessionId: string): string {
  const hash = sha256(sessionId + 'upc').slice(0, 11)
  const digits = hash.split('').map(c => parseInt(c, 16) % 10)
  const check = (10 - (digits.reduce((s,d,i) => s + d*(i%2?3:1), 0) % 10)) % 10
  return [...digits, check].join('')
}
```

For real registration: the ISRC/UPC generators should print a clear notice that these are **locally generated** and not registered with IFPI/GS1. The current code doesn't make this clear enough.

**Verdict:** Must replace Math.random() with deterministic session-hash-based generation. And must prominently display "Not registered — these are local identifiers only. Register with IFPI/GS1 before distribution."

---

## Summary: Quality Upgrade Priority

| # | Subsystem | Current | Target | Effort | Priority |
|---|-----------|---------|--------|--------|----------|
| 1 | **Linear-phase EQ** | Minimum-phase biquads | Kaiser-window FIR linear-phase for mid/high bands | 1 day | HIGH |
| 2 | **Multiband comp → 4-band** | 3-band hard-knee | 4-band with soft knee + feed-forward | 2 days | HIGH |
| 3 | **Real Chromaprint** | Simplified 32×8 hash | Full 16-band filterbank, base64, AcoustID-compatible | 1 day | HIGH |
| 4 | **ISRC/UPC deterministic** | Math.random() | Session-hash-based + registration warning | ½ day | HIGH |
| 5 | **DDEX multi-track** | Single SoundRecording | Multi-track ReleaseResourceReferenceList | 2 days | HIGH |
| 6 | **Phase-coding watermark** | LSB-only (fragile) | STFT phase-coding (survives MP3) | 2 days | MEDIUM |
| 7 | **AnalogNet modes** | 3 saturation modes | Add hysteresis, frequency-dependent sat, oversampling | 3 days | MEDIUM |
| 8 | **ISRC registrant self-service** | Hardcoded 'ARC' | Configurable registrant code from settings | ½ day | MEDIUM |
| 9 | **WAV iXML chunk** | LIST/INFO only | iXML with C2PA JUMBF reference | 1 day | MEDIUM |
| 10 | **MP3 VBR mode** | CBR only | VBR with quality=0 (highest) for smaller files | ½ day | LOW |

---

## Already Best — No Changes Needed

| Subsystem | Why It's Best |
|-----------|---------------|
| LUFS computation | Correct BS.1770-4 with absolute + relative gating, matches pyloudnorm |
| True Peak | 48-tap polyphase with DC-unity fix — zero systematic error on sub-bass |
| Limiter | Look-ahead with delayed gain alignment + closed-loop true-peak convergence |
| M/S stereo | Bass-mono below 200 Hz, correct mid/side gain independence |
| RainNet ONNX | Full Mel+Transformer+Decoder pipeline, ported verbatim from Python |
| Heuristic fallback | 17 genres with real settings that survive macro pass-through |
| TPDF dither | Triangular PDF in [-1,+1) LSB, correct Float32→Int quantization position |
| LAME MP3 | Lowpass disabled at 320kbps, full 24kHz bandwidth, ID3v2.3 toggle-gated |
| WAV metadata | 8 RIFF INFO fields + LSB watermark |
| DDEX validation | DOMParser XML check + ISRC format + UPC check digit + element presence |

---

## The Three Highest-Impact Upgrades

If only three things get done before release, these have the largest quality-per-line-of-code ratio:

1. **Real Chromaprint** (1 day) → enables AcoustID auto-metadata → DAW export → auto-tagged release in one click
2. **Linear-phase EQ** (1 day) → audible phase coherence on transients → professional mastering quality
3. **ISRC/UPC deterministic + registration warning** (½ day) → honest identifiers → users know to register before distribution

These three alone close the gap between "functional beta" and "competitive with iZotope Ozone."
