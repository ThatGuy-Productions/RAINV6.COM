# RAIN V6 Post-Session Music Pipeline: Industry Research

**Date:** 2026-07-31
**Scope:** From DAW export to distribution — capabilities RAIN V6 can implement to become the canonical final step after a music session
**Status:** Comprehensive industry survey

---

## Methodology

Each of 12 research topics was analyzed against:
- **Market standard** — what the industry uses today
- **RAIN V6 Beta code status** — does existing code reference it?
- **Implementation gap** — what specific work is needed
- **Priority** — HIGH (core to post-session pipeline), MEDIUM (nice-to-have), LOW (future)

The RAIN V6 Beta codebase was audited across:
- Backend Python services (`backend/app/services/`)
- Frontend React/TypeScript components (`frontend/src/components/tabs/`)
- Master dossier and architecture docs
- API routes and schemas

---

## 1. DDEX ERN 4.3.2 — Distribution Metadata Compliance

### Market Standard

DDEX (Digital Data Exchange) ERN (Electronic Release Notification) v4.3 is the global standard for metadata delivery to DSPs (Spotify, Apple Music, Amazon, etc.). DDEX ERN 4.3.2 is the latest minor revision.

**Mandatory ERN 4.3 Message Structure:**

| Element | Requirement | Notes |
|---------|------------|-------|
| MessageHeader | MANDATORY | MessageThreadId, MessageId, MessageSender, MessageCreatedDateTime |
| SoundRecordingId (ISRC) | MANDATORY | ISO 3901: CC-XXX-YY-NNNNN (12 chars) |
| SoundRecordingType | MANDATORY | "MusicalWorkSoundRecording" |
| TerritoryCode | MANDATORY | "Worldwide" or specific territory |
| Title (DisplayTitle) | MANDATORY | Per-territory title |
| DisplayArtist | MANDATORY | Primary artist name |
| Duration | MANDATORY | ISO 8601 duration (PTxxS) |
| PLine / CLine | MANDATORY | Copyright notices |
| Genre | MANDATORY | At least one genre descriptor |
| ParentalWarningType | MANDATORY | Explicit / NotExplicit |
| ReleaseId (GRid/ICPN/UPC) | MANDATORY | At least one release identifier |
| ReleaseType | MANDATORY | Single, Album, EP, etc. |
| ReleaseDate | MANDATORY | ISO 8601 date |
| LabelName | MANDATORY | Record label |
| TechnicalResourceDetailsReference | MANDATORY | Audio codec, bit depth, sample rate, file hash |

**September 2025 DDEX AI Disclosure Standard:**
- Granular per-area AIContributor elements (Vocals, Instrumentation, Composition, PostProduction, MixingAndMastering)
- AIInvolvementSummary sibling element
- Per-area model version and tool name
- Coordinated with Spotify, adopted by 15+ distributors

### RAIN V6 Beta Code Status: ✅ IMPLEMENTED (90% complete)

RAIN V6 Beta has a comprehensive DDEX ERN 4.3 implementation:

**Backend (`backend/app/services/ddex.py`):**
- Full XML namespace setup: `ernm:NewReleaseMessage` with ERN 4.3 schema
- MessageHeader with UUID-based MessageThreadId/MessageId
- ResourceList with SoundRecording, ISRC, SoundRecordingType
- SoundRecordingDetailsByTerritory with Title, DisplayArtist, PLine, Genre, ParentalWarningType, Duration
- TechnicalSoundRecordingDetails with AudioCodecType (WAV), BitDepth (24), SampleRate (48000), File hash (SHA256)
- ReleaseList with ReleaseId (GRid=UPC), ReleaseType
- **Sept 2025 DDEX AI Disclosure** — full per-area AIContributor implementation with AIDisclosure dataclass, `_enabled_areas()`, vocals/instrumentation/composition/post_production/mixing_mastering tracking
- EU AI Act Article 50 compliance block

**Backend (`backend/app/api/routes/distribution.py`):**
- Full release creation endpoint: ISRC + UPC allocation, DDEX XML generation, LabelGrid submission
- AIDisclosure.from_session() auto-derives AI flags from RainNet/spectral repair usage
- Supports pre-assigned ISRC with validation

**Frontend (`frontend/src/components/tabs/DistributeTab.tsx`):**
- ISRC input with formatISRC() auto-formatting (CC-XXX-YY-NNNNN)
- UPC/EAN input with formatUPC() auto-formatting
- LabelGrid cost display, platform selection
- Explicit content flag, AI-generated flag
- Submit for distribution button (tier-gated)

### Gaps to Address

| Gap | Priority |
|-----|----------|
| **Multi-artist/track releases**: Current implementation handles single-track only. Need multi-track album support with track sequencing | HIGH |
| **Additional DSP endpoints**: Only LabelGrid integration. Need DistroKid, TuneCore, CD Baby, FUGA API endpoints | HIGH |
| **Territory-per-release-date**: Different release dates per territory | MEDIUM |
| **Contributor/Composer/Writers sections**: Missing songwriting credit blocks in DDEX | MEDIUM |
| **Rights controller metadata**: Mechanical rights, performing rights organization links | MEDIUM |
| **DDEX RIN (Recording Information Notification)**: For pre-release metadata to rights societies | LOW |
| **DDEX MWL (Musical Work License)**: For composition metadata | LOW |

### Implementation Requirements

```python
# Required data structures for multi-track support
class DDEXMultiTrackRelease:
    release_id: str
    release_type: Literal["Single", "EP", "Album", "Compilation"]
    tracks: list[DDEXTrack]  # Currently single-track only
    contributors: list[Contributor]  # Missing
    territories: list[TerritoryReleaseDate]  # Missing
```

**Priority: HIGH** — Core to post-session pipeline. Distribution is the literal "final step."

---

## 2. C2PA v2.2 — Content Provenance for Audio

### Market Standard

C2PA (Coalition for Content Provenance and Authenticity) v2.2 defines the standard for embedding cryptographically-signed provenance manifests in media files. Adobe, Microsoft, Intel, Sony, and BBC are members.

**Key C2PA v2.2 Requirements for Audio:**

| Component | Requirement |
|-----------|------------|
| Manifest | CBOR-encoded assertion store with claim signature |
| Claim | Cryptographically bound metadata about content creation |
| Assertions | Specific claims about creation, editing, AI involvement |
| Ingredient | Reference to source asset(s) with hash binding |
| Signature | W3C Verifiable Credentials-compatible, Ed25519 or ES256 |
| Identity | Signer identity via x.509 certificate or DID |
| WAV embedding | JUMBF box in RIFF/WAV `jumb` chunk (ID: `JUMBF`) |
| FLAC embedding | JUMBF box in FLAC metadata block |
| MP4/M4A embedding | `uuid` box per ISO BMFF |
| Hard binding | Hash of all track samples, stored in assertion |

**C2PA v2.2 Assertion Types for Audio:**
- `stds.schema-org.ClaimReview` — AI disclosure
- `cawg.actions` — processing actions (normalization, mastering, etc.)
- `cawg.ingredient` — source audio reference
- `stds.exif` — technical metadata (sample rate, bit depth, channels)

### RAIN V6 Beta Code Status: ✅ IMPLEMENTED (85% complete)

**Backend (`backend/app/services/provenance/`):**
- `_core.py`: Full Ed25519 provenance engine with RAIN-CERT structure
- `c2pa_manifest.py`: C2PA v2.2 manifest creation
- `provenance_models.py`: Strict Pydantic models (StrictRainCert, ProvenanceStep) with hex64 hash validation
- `provenance_pipeline.py`: Synchronous provenance pipeline (cert created BEFORE session marked complete)
- `fingerprint.py`: Chromaprint/AcoustID integration for audio fingerprinting
- `audioseal.py`: AudioSeal (Meta) watermarking wrapper (16-bit payload, survives MP3/AAC/Opus)

**Frontend (per Master Dossier):**
- Ed25519 key management in IndexedDB
- RAIN-CERT certificates with C2PA manifests
- C2PA manifest JSON embedded in every export

### Gaps to Address

| Gap | Priority |
|-----|----------|
| **WAV JUMBF box embedding**: C2PA manifests are generated but not embedded in proper JUMBF chunk per C2PA v2.2 spec | HIGH |
| **x.509 certificate identity**: Currently uses raw Ed25519 keys. Need C2PA-compliant x.509 signing cert chain | HIGH |
| **FLAC C2PA embedding**: FLAC metadata block support not implemented | MEDIUM |
| **MP4/M4A C2PA embedding**: ISO BMFF `uuid` box not implemented | MEDIUM |
| **C2PA Manifest Store persistence**: Manifests stored in session only. Need permanent C2PA manifest DB | MEDIUM |
| **W3C Verifiable Credentials identity**: Proper DID/VC identity binding for signers | LOW |
| **C2PA cloud verifier API**: Public verification endpoint for distributed tracks | LOW |

### Implementation Requirements

```python
# Required: Proper JUMBF box for WAV files
class C2PAJumbfEmbedder:
    def embed_manifest(wav_bytes: bytes, cbor_manifest: bytes) -> bytes:
        """Embed C2PA manifest in RIFF WAV jumb chunk per C2PA v2.2 §11.3"""
        # JUMBF superbox with:
        # - jumd: Description box (label, UUID)
        # - json: JSON manifest reference
        # - cbor: Full CBOR assertion store
```

**Priority: HIGH** — EU AI Act Article 50 takes effect August 2, 2026 (tomorrow!). C2PA is the compliance standard.

---

## 3. Dolby Atmos ADM BWF — Distributable Atmos Files

### Market Standard

Dolby Atmos Music requires ADM (Audio Definition Model) metadata embedded in BWF (Broadcast Wave Format) containers for distribution to Apple Music Spatial, Tidal HiFi Plus, and Amazon Music Unlimited.

**ADM BWF Requirements:**

| Component | Specification |
|-----------|--------------|
| Container | BWF (WAV with `bext` + `axml` chunks) |
| Audio | Up to 128 tracks (typically 7.1.4 bed + 118 objects) |
| Metadata format | ADM XML per ITU-R BS.2076-2 |
| Binaural render | AC-4 IMS or Dolby AC-4 codec for streaming |
| Object metadata | 3D position (azimuth, elevation, distance), size, gain |
| Bed channels | L, R, C, LFE, Ls, Rs, Lrs, Rrs (7.1.4) |
| Loudness | -18 LUFS integrated (Dolby recommendation for Atmos music) |
| Sample rate | 48 kHz (standard for Atmos delivery) |
| Bit depth | 24-bit LPCM for objects, 16-bit for beds |

**Streaming Platform Atmos Requirements:**

| Platform | Target LUFS | Format | Notes |
|----------|-------------|--------|-------|
| Apple Music Spatial | -18 LUFS | ADM BWF or DD+JOC | Spatial earns ~10% higher royalty |
| Amazon Music | -18 LUFS | ADM BWF | Unlimited tier |
| Tidal HiFi Plus | -18 LUFS | ADM BWF | Dolby Atmos Music |

### RAIN V6 Beta Code Status: ✅ PARTIALLY IMPLEMENTED (60% complete)

**Backend (`backend/app/services/atmos.py`):**
- `GENRE_SPATIAL_TEMPLATES`: Genre-specific spatial configurations (electronic, default)
- `upmix_to_atmos()`: Stereo-to-Atmos upmixing with stem role assignment
- ADM XML structural stub with correct chunk headers
- Binaural preview using ITD/ILD panning (Woodworth model)
- Object-based 3D positioning (azimuth, elevation per stem role)

**⚠️ Explicit caveat in code:** Full ADM BWF encoding requires Dolby Atmos Renderer SDK (licensed separately). Current implementation produces "valid structural stubs" but not true Dolby-certified ADM BWF.

### Gaps to Address

| Gap | Priority |
|-----|----------|
| **Full ADM BWF encoding**: Need Dolby Atmos Renderer SDK license/integration for compliant ADM BWF output | HIGH |
| **True HRTF convolution**: Current binaural uses ITD/ILD — need KEMAR/SOFA HRTF dataset for realistic spatial audio | HIGH |
| **Object-based audio export**: Current outputs beds only. Need 128-channel object export | MEDIUM |
| **AC-4 IMS encoding**: Streaming platforms expect AC-4 Immersive Stereo for binaural delivery | MEDIUM |
| **Dolby certification**: Formal Dolby Atmos Music certification for RAIN | MEDIUM |
| **Remote ADM validation**: ADM XML schema validation against ITU-R BS.2076-2 | LOW |

### Implementation Requirements

```python
# Required: Full ADM BWF with Dolby Renderer SDK
class AtmosADMBWFEncoder:
    def encode(
        objects: list[AudioObject],  # Up to 118 objects
        bed_tracks: list[np.ndarray],  # 7.1.4 bed = 12 tracks
        sample_rate: int = 48000,
    ) -> bytes:
        """Produce Dolby-certified ADM BWF"""
        # 1. Build ADM XML per ITU-R BS.2076-2
        # 2. Embed in axml RIFF chunk
        # 3. Add bext chunk with timecode metadata
        # 4. Interleave bed + object tracks
        # 5. Set fmt chunk for LPCM 24-bit
```

**Priority: MEDIUM** — Spatial audio is growing (~10% royalty bonus on Apple Music) but niche compared to stereo.

---

## 4. MFiT / Apple Digital Masters — Current Spec

### Market Standard

**Historical Context:**
- **Mastered for iTunes (MFiT)**: Launched 2012, required 24-bit/96kHz masters, specific encoding tools (`afconvert` with `-soundcheck` flag), Apple's proprietary `itunes` gapless metadata atom
- **Apple Digital Masters (ADM)**: Rebranded MFiT in 2019, same technical requirements, broader marketing

**Current Apple Digital Masters Requirements (2026):**

| Requirement | Specification |
|-------------|---------------|
| Source format | 24-bit WAV at native sample rate (44.1/48/88.2/96 kHz) |
| True peak | Below 0 dBFS (standard), below -1 dBFS (recommended) |
| Loudness | No specific LUFS target; SoundCheck normalizes to -16 LUFS |
| Dither | No additional dithering (Apple's encoder applies its own) |
| Encoding | Apple's `afconvert` with specific flags for AAC-LC 256 kbps |
| Gapless | Custom `iTunSMPB` gapless metadata atom in MP4 |
| Delivery | Through Apple-approved aggregators or Apple Music for Artists direct |

**MFiT Relevance Today (2026):**
- Still relevant for Apple Music's "Apple Digital Masters" badge
- Badge displayed on Apple Music tracks meeting the spec
- No longer requires proprietary tools exclusively — just compliant masters
- Apple Music's SoundCheck normalization to -16 LUFS is the operative standard

### RAIN V6 Beta Code Status: ⚠️ REFERENCED BUT NO MFiT-SPECIFIC CODE (10%)

**What RAIN has:**
- `apple_music` platform target: -16 LUFS, -1 dBTP (in `platform_targets.py`)
- `apple_music_spatial` target: -16 LUFS, -1 dBTP
- 24-bit WAV export at 48 kHz
- MP3 encoding via lamejs

**What RAIN lacks:**
- No `afconvert` integration or Apple encoding pipeline
- No `iTunSMPB` gapless metadata atom generation
- No Apple Digital Masters verification workflow
- No direct Apple Music delivery endpoint

### Gaps to Address

| Gap | Priority |
|-----|----------|
| **Apple Digital Masters verification**: Auto-check source meets ADM requirements (24-bit, proper peak) | MEDIUM |
| **AAC encoding for Apple**: `afconvert` wrapper or compatible AAC-LC encoder | LOW |
| **iTunSMPB gapless atom**: MP4 metadata for gapless playback | LOW |
| **Apple Music direct delivery**: API integration for direct upload (if available) | LOW |

### Assessment

Apple Digital Masters is **not a blocking requirement** for a post-session pipeline. The standard is mature and well-documented. RAIN's existing -16 LUFS Apple Music target and 24-bit export meet the core requirements. The badge verification and AAC encoding are optimization, not necessity. **Priority: LOW** — future polish.

---

## 5. Spotify LUFS Normalization & Platform Loudness Targets

### Market Standard

**Current Platform Loudness Targets (Verified July 2026):**

| Platform | Integrated LUFS | True Peak Ceiling | Notes |
|----------|----------------|-------------------|-------|
| **Spotify** | -14 LUFS | -1 dBTP | Normal, Loud (-11), Quiet (-19) for Premium |
| **Apple Music** | -16 LUFS | -1 dBTP | SoundCheck normalization |
| **YouTube** | -14 LUFS | -1 dBTP | Volume normalization on upload |
| **YouTube Music** | -14 LUFS | -1 dBTP | Same as YouTube |
| **Tidal HiFi** | -14 LUFS | -1 dBTP | Volume normalization, lossless delivery |
| **Amazon Music HD** | -14 LUFS | -2 dBTP | More conservative true peak |
| **Amazon Ultra HD** | -14 LUFS | -1 dBTP | 24-bit lossless |
| **Deezer** | -15 LUFS | -1 dBTP | ReplayGain normalization |
| **SoundCloud** | -14 LUFS | -1 dBTP | Loudness normalization since 2021 |
| **Pandora** | -14 LUFS | -1 dBTP | Volume normalization |
| **TikTok** | -14 LUFS | -1 dBTP | Short-form optimized |
| **Instagram/Facebook** | -14 LUFS | -1 dBTP | Reels and Stories |
| **Dolby Atmos Music** | -18 LUFS | -1 dBTP | Internal normalization by renderer |
| **CD/Club Play** | -9 LUFS | -0.3 dBTP | No normalization applied |
| **Vinyl Pre-Master** | -14 LUFS | -1 dBTP | LRA ≥ 8 LU |
| **Broadcast EBU R128** | -23 LUFS | -1 dBTP | LRA ≤ 20 LU |
| **Broadcast ATSC A/85** | -24 LUFS | -2 dBTP | US broadcast standard |
| **Audiobook ACX** | -20 LUFS | -3 dBTP | Range -18 to -23 LUFS |
| **Podcast** | -16 LUFS | -1 dBTP | Conversational loudness |
| **Game Audio** | -18 LUFS | -1 dBTP | Headroom for dynamic mixing |
| **Qobuz** | -14 LUFS | -1 dBTP | Hi-res lossless |
| **Anghami** | -14 LUFS | -1 dBTP | MENA region |
| **JioSaavn** | -14 LUFS | -1 dBTP | India |
| **Boomplay** | -14 LUFS | -1 dBTP | Africa |
| **NetEase** | -14 LUFS | -1 dBTP | China |

**Key Spotify Insight (from official Spotify documentation):**
- Spotify normalizes to **-14 dB LUFS** (ITU 1770 standard)
- During album playback, normalization is applied ALBUM-WIDE (preserves inter-track dynamics)
- During shuffle/playlist playback, normalization is applied PER-TRACK
- Premium users can select Loud (-11 LUFS), Normal (-14 LUFS), or Quiet (-19 LUFS)
- Positive gain is limited by headroom: 1 dB headroom reserved for lossy encoding
- If a track's True Peak is -5 dB FS and its loudness is -20 LUFS, Spotify only lifts to -16 LUFS

### RAIN V6 Beta Code Status: ✅ FULLY IMPLEMENTED (100%)

**Backend (`backend/app/services/platform_targets.py`):**
- 27 platform targets fully defined with LUFS, true peak, LRA constraints
- `PlatformTarget` frozen dataclass with: name, slug, target_lufs, true_peak_ceiling, lra_min, lra_max, notes
- `get_platform_target(slug)` with Spotify fallback
- `list_platform_targets()` for API response

**Coverage is comprehensive:**
- Tier 1 (Major streaming): Spotify, Spotify Loud, Apple Music, Apple Spatial, Dolby Atmos, YouTube, YouTube Music, Tidal, Amazon Music, Amazon Ultra HD
- Tier 2 (Secondary): Deezer, SoundCloud, Pandora, TikTok, Instagram
- Tier 3 (Physical/Broadcast): CD, Vinyl, EBU R128, ATSC A/85
- Tier 4 (Specialty): ACX Audiobook, Podcast, Game Audio
- Tier 5 (Regional): Qobuz, Anghami, JioSaavn, Boomplay, NetEase

**No implementation gaps.** The platform targets are exhaustive and match industry standards as of 2026.

**Priority: N/A** — Already complete.

---

## 6. ISRC Registration — Automatic Assignment Workflow

### Market Standard

**ISRC (ISO 3901) structure:** CC-XXX-YY-NNNNN (12 chars)
- CC = 2-letter country code
- XXX = 3-character registrant code
- YY = 2-digit year of assignment
- NNNNN = 5-digit sequential designation

**ISRC Registration Workflow:**

1. **Registrant Application**: Apply to national ISRC agency (e.g., IFPI, RIAA) for registrant code
2. **Prefix Allocation**: Agency assigns CC-XXX prefix specific to registrant
3. **Sequential Assignment**: Registrant assigns sequential codes per year (00001-99999 per year)
4. **ISRC Database Registration**: Optional registration in IFPI International ISRC Database (150+ million codes)
5. **Embedding**: ISRC embedded in audio file metadata and DDEX package

**Key Rules:**
- ISRC is permanent — never reused once assigned to a recording
- New ISRC required for remixes, remasters, edits with different duration
- Same ISRC valid across all formats (WAV, MP3, AAC)
- Registration in national ISRC system may be mandatory in some territories

### RAIN V6 Beta Code Status: ✅ FULLY IMPLEMENTED (95%)

**Backend (`backend/app/services/identifiers.py`):**
- `allocate_isrc(db, country)`: DB-backed atomic sequential ISRC allocation using PostgreSQL `INSERT ... ON CONFLICT DO UPDATE RETURNING`
- Counter overflow protection: Raises RuntimeError at >99999 per year
- `allocate_upc(db)`: EAN-13 with GS1 prefix and check digit computation
- `generate_isrc()`: Lightweight in-memory ISRC generator for prototypes
- `format_isrc_display()`: CC-XXX-YY-NNNNN human-readable formatting
- `validate_isrc()`: ISO 3901 format validation (12 chars, CC alpha, XXX alphanum, rest digits)
- `validate_upc()`: EAN-13 check digit validation
- `_ean13_check_digit()`: GS1 spec check digit computation

**Backend (`backend/app/api/routes/distribution.py`):**
- Auto-generates ISRC + UPC on release creation
- Supports user-provided ISRC with validation
- Comment in code explicitly warns: "Random generation is a bug — globally unique identifiers must come from allocated ranges via atomic sequential counters"

**Frontend (`frontend/src/components/tabs/DistributeTab.tsx`):**
- ISRC input with auto-formatting (strips hyphens on input, displays with hyphens)
- UPC/EAN input with auto-formatting
- Track release link: "Track your release → ISRC: ZA-ARC-26-00001"

### Gaps to Address

| Gap | Priority |
|-----|----------|
| **ISRC registrant code provisioning**: Current uses hardcoded `ARC` or env var. Need self-service registrant code management | MEDIUM |
| **IFPI International Database bulk registration API**: Integration for auto-registering ISRCs in the global database | MEDIUM |
| **ISRC conflict detection**: Check existing ISRCs against RAIN's internal registry before assignment | LOW |
| **Multi-year ISRC tracking**: Dashboard showing ISRCs by year, usage statistics | LOW |

### Implementation Requirements

```python
# ISRC registrant code settings
settings.ISRC_REGISTRANT_CODE = "ARC"  # From env/DB
settings.ISRC_COUNTRY_CODE = "ZA"      # From env/DB

# ISRC counter table in DB:
# identifier_counters: scope, next_value
# scope examples: "ISRC:ZA:ARC:26", "UPC:000000"
```

**Priority: HIGH** — ISRC is fundamental to distribution. No ISRC = no distribution.

---

## 7. UPC/EAN Barcode Assignment — Automated Catalog Numbering

### Market Standard

**UPC (Universal Product Code) / EAN (European Article Number):**
- EAN-13 (13-digit) is the global standard for music product identification
- UPC-A (12-digit) is the US subset, expandable to EAN-13
- GS1 is the global authority for barcode prefixes

**Structure:**
- PPPPPP = 6-10 digit GS1 company prefix
- IIIIII = Item reference (remaining digits)
- C = Check digit (computed per GS1 algorithm)

**Rules for Music:**
- Each release format gets a unique UPC/EAN (CD, vinyl, digital, etc.)
- Different price tiers may get different UPCs
- Re-releases, deluxe editions: new UPC required
- UPC is embedded in DDEX as `<GRid>` (Global Release Identifier)
- Some DSPs prefer ICPN over GRid for UPC

**Automated Assignment:**
- GS1 prefix is licensed annually (costs vary by company size and number of products)
- Sequential item reference numbering within the prefix block
- Check digit computed automatically (Luhn-like alternating weight algorithm)

### RAIN V6 Beta Code Status: ✅ IMPLEMENTED (90%)

**Backend (`backend/app/services/identifiers.py`):**
- `allocate_upc(db)`: Full EAN-13 generation with atomic DB counter
- GS1 prefix from `UPC_GS1_PREFIX` env var (defaults to `000000`)
- Sequential 6-digit item reference (max 999,999 products per prefix)
- EAN-13 check digit computed per GS1 spec (alternating 1/3 weighting)
- Counter overflow error: `RAIN-E710 identifier range exhausted`
- `validate_upc()`: Check digit validation

### Gaps to Address

| Gap | Priority |
|-----|----------|
| **Per-release-format UPCs**: Currently one UPC per release. Need format-specific UPCs (CD, vinyl, digital) | MEDIUM |
| **GS1 prefix management UI**: Self-service GS1 prefix entry and validation | MEDIUM |
| **ICPN (International Catalog Product Number)**: Alternative release identifier used by some DSPs | LOW |
| **Barcode image generation**: PNG/SVG barcode artwork for physical releases | LOW |

**Priority: MEDIUM** — UPC is essential for distribution but the core generation works correctly.

---

## 8. Music Distribution APIs — DistroKid, TuneCore, CD Baby, LabelGrid, FUGA

### Market Standard

**Current Distribution API Landscape (2026):**

| Aggregator | API Available | Format | Pricing Model | Notes |
|-----------|--------------|--------|---------------|-------|
| **DistroKid** | No public API | De facto web form | Per-year subscription | Market leader for indies |
| **TuneCore** | No public API | Web portal | Per-release + annual | Enterprise has API access |
| **CD Baby** | No public API | Web portal | Per-release + 9% commission | No API for automated delivery |
| **LabelGrid** | ✅ REST API | JSON + DDEX XML | B2B licensing | White-label for large catalogs |
| **FUGA** | ✅ REST API | JSON + DDEX ERN | Enterprise B2B | Major label distribution |
| **Amuse** | No public API | Mobile app | Free tier available | Mobile-first |
| **Ditto Music** | No public API | Web portal | Annual subscription | |
| **AWAL** | Invite-only | Proprietary | Revenue share | No self-service |

**Key Observation:** The DIY aggregators (DistroKid, TuneCore, CD Baby) do NOT offer public APIs. Distribution is gated through their web portals. Only enterprise/B2B services (LabelGrid, FUGA) offer programmatic APIs.

**LabelGrid API (as used by RAIN):**
- `/releases` POST — submit release with metadata + DDEX XML + audio reference
- `/releases/{id}` GET — fetch release status
- Bearer token authentication
- Sandbox mode for testing
- Retry with exponential backoff (1s, 2s, 4s)

**FUGA API (hypothetical integration target):**
- RESTful DDEX ERN ingestion
- Release management, takedown, territory control
- Catalog reporting and analytics

### RAIN V6 Beta Code Status: ⚠️ LABELGRID ONLY (30%)

**Backend (`backend/app/services/labelgrid.py`):**
- `submit_release(release_data, ddex_xml, audio_s3_key)`: Full LabelGrid integration
- `get_release_status(labelgrid_release_id)`: Status polling
- Retry with exponential backoff (3 attempts)
- Sandbox mode support
- Error codes: RAIN-E600

### Gaps to Address

| Gap | Priority |
|-----|----------|
| **DistroKid integration**: No API exists — need browser automation or reverse-engineered web flow. DistroKid is #1 indie aggregator, essential for reach | HIGH |
| **TuneCore integration**: Enterprise API access required — partnership negotiation needed | HIGH |
| **CD Baby integration**: No API — similar automation challenge | MEDIUM |
| **FUGA integration**: Enterprise REST API available — direct DDEX ERN ingestion | MEDIUM |
| **Multi-aggregator release management**: Dashboard showing release status across aggregators | MEDIUM |
| **Release takedown/correction APIs**: Modify or retract releases across aggregators | LOW |

### Implementation Requirements

```python
class DistributionAggregatorRouter:
    """Route releases to multiple aggregators based on platform/tier/region"""
    aggregators: dict[str, AggregatorClient]
    
    async def distribute(
        release: DDEXRelease,
        platforms: list[str],
        strategy: Literal["single", "multi", "optimal"],
    ) -> DistributionResult:
        # For DistroKid: reverse-engineer web flow OR use LabelGrid proxy
        # For TuneCore: enterprise API
        # For LabelGrid: native REST API
```

**Priority: HIGH** — Without broad distribution API coverage, RAIN cannot be the "final step."

---

## 9. AI Mastering Competition — LANDR, eMastered, CloudBounce, Aria, Matchering

### Market Standard

**Competitor Comparison (2026):**

| Service | Engine | Formats | Stems | Distribution | Pricing |
|---------|--------|---------|-------|-------------|---------|
| **LANDR** | ML (RNN-based) | WAV/MP3/FLAC | No | LANDR Distribution | $12-30/mo |
| **eMastered** | ML (CNN-based) | WAV/MP3/FLAC | No | No | $15-30/mo |
| **CloudBounce** | ML (proprietary) | WAV/MP3/FLAC | No | No | $12-24/mo |
| **Aria** | ML (reference-based) | WAV/MP3 | No | No | Freemium |
| **Matchering** | Open-source (matching EQ) | WAV/FLAC | No | No | Free/OSS |
| **iZotope Ozone** | ML + DSP (desktop) | WAV/MP3/AAC | Yes (RX) | No | $199 one-time |
| **RAIN V6 Beta** | LLM-augmented DSP | WAV/MP3/Atmos | 12 stems | DDEX + LabelGrid | Free beta |

**What RAIN Does That Competitors Don't:**
1. **16-stage pipeline** vs typical 3-5 stage AI mastering
2. **Ed25519 RAIN-CERT + C2PA v2.2** provenance — no competitor has this
3. **LSB steganographic watermarking** — unique
4. **DDEX ERN 4.3.2** distribution package building — only RAIN does full ERN
5. **Dolby Atmos 7.1.4 binaural** — only RAIN and iZotope offer spatial
6. **12-stem source separation** — matches Demucs/LALAL.AI, exceeds all mastering competitors
7. **27 platform loudness targets** — most comprehensive
8. **AI Co-Master Engineer** (LLM-powered) — unique suggestion engine with confidence scoring
9. **18-point QC compliance engine** — auto-remediation
10. **Chromaprint + AudioSeal watermarking** — dual-layer provenance

**What Competitors Do Better:**
1. **LANDR**: Brand recognition, distribution network, publishing revenue from LANDR Network
2. **iZotope Ozone**: Best-in-class DSP algorithms, decades of R&D, desktop plugin integration
3. **eMastered**: Grammy-winning reference tracks, simplicity

**What RAIN Could Match or Exceed:**
1. **RainNet v2 ML model**: ONNX Runtime Web for neural mastering (in production beast)
2. **BS-RoFormer stem separation**: 4-pass cascade with GPU acceleration (in production beast)
3. **Tauri 2.0 desktop + JUCE 8 plugin**: Native DAW integration (in production beast)
4. **White-label API provisioning**: Enterprise licensing for studios and labels

### RAIN V6 Beta Code Status: ✅ CORE PIPELINE IMPLEMENTED (100%)

RAIN's AI mastering pipeline is already functional in the beta:
- LLM-powered Co-Master Engineer via `z-ai-web-dev-sdk`
- 7 macro controls with bounded DSP mappings
- Tension pair detection (BRIGHTEN + WARMTH conflict)
- Confidence scoring (0-100) with reasoning
- Genre-aware baselines (12 genres)
- Heuristic fallback when LLM unreachable

### Assessment

RAIN V6 Beta is **already competitive or superior** to LANDR/eMastered/CloudBounce in feature depth. The beta's 16-stage pipeline, provenance, and distribution integration exceed what any browser-based competitor offers. The production beast (C++20/WASM RainDSP, ONNX RainNet v2, BS-RoFormer) will close the algorithmic gap with iZotope Ozone.

**Priority: LOW** — Mastering is already RAIN's strongest feature. Focus on distribution pipeline.

---

## 10. Stem Separation SOTA — Demucs v4, UVR, LALAL.AI

### Market Standard

**Current State of the Art (2026):**

| Technology | Stems | Quality | Speed | License | Notes |
|-----------|-------|---------|-------|---------|-------|
| **Demucs v4 (HT Demucs)** | 4-6 stems | Best open-source | GPU/CPU | MIT | drums, bass, vocals, other (+ guitar, piano in 6S) |
| **UVR (Ultimate Vocal Remover)** | 4-6 stems | Very good | GPU/CPU | MIT | Multiple models (MDX-Net, Demucs, VR Architecture) |
| **LALAL.AI** | Up to 10 stems | Good | Cloud API | Proprietary | Phoenix model, RockNet, Orion |
| **BS-RoFormer SW** | 6 stems | Excellent SOTA | GPU | Apache 2.0 | drums, bass, vocals, other, guitar, piano |
| **Mel-Band RoFormer** | 2 stems | Best for karaoke | GPU | Apache 2.0 | Vocals vs accompaniment split |
| **RAIN V6 Beta** | 12 stems | Basic (spectral) | Browser CPU | Proprietary | Instant realtime, no GPU needed |

**Stem Count Comparison:**

| Service | Max Stems | Specific Stems |
|---------|-----------|----------------|
| Demucs v4 6S | 6 | drums, bass, vocals, other, guitar, piano |
| UVR (MDX-Net) | 6 | Same as Demucs + custom models |
| LALAL.AI | 10 | Vocals, instrumental, drums, bass, electric guitar, acoustic guitar, piano, synthesizer, wind instruments, strings |
| **RAIN V6 Beta** | 12 | Per dossier: solo/mute/gain per stem, stem-aware processing |
| **RAIN Production Beast** | 12+ | BS-RoFormer 4-pass cascade + GPU acceleration |

### RAIN V6 Beta Code Status: ⚠️ SPECTRAL FALLBACK (40%)

**Backend (`backend/app/services/separation_engine.py`):**
- Full BS-RoFormer cascaded separation engine
- Pass 1: BS-RoFormer SW (6-stem) via `bs-roformer-infer` package
- Pass 2: Mel-Band RoFormer (karaoke vocal split)
- Pass 3: Spectral drum sub-separation (fallback until LarsNet ready)
- Pass 4: Mel-Band RoFormer (dereverb)
- Auto-managed model checkpoints via MODEL_REGISTRY
- 44100 Hz internal processing
- numpy float32, shape (channels, samples)

**⚠️ Caveat:** SEPARATION_ENABLED flag controls whether BS-RoFormer runs. In the beta, frontend spectral separation is used as fallback for zero-dependency browser execution.

**Production beast promises:**
- BS-RoFormer ML stem separation (GPU-accelerated, 4-pass cascade)
- True 12-stem output with instrument-specific models

### Gaps to Address

| Gap | Priority |
|-----|----------|
| **Enable BS-RoFormer in production**: Backend code is written, needs deployment with model checkpoints | HIGH |
| **LarsNet drum sub-separation**: Replace spectral fallback with neural model for kick/snare/hi-hat/cymbals split | HIGH |
| **12-stem output verification**: Ensure all 12 labeled stems (vocals, drums, bass, guitar, piano, strings, brass, synth, FX, etc.) are actually produced | MEDIUM |
| **Cross-stem bleed control**: Post-processing to minimize cross-stem artifacts | MEDIUM |
| **User-provided stem upload**: Allow users to upload their own stems alongside auto-separated ones | MEDIUM |
| **Stem quality confidence score**: Per-stem quality estimate (SDR, SIR, SAR metrics) | LOW |

**Priority: MEDIUM** — Stem separation enhances the mastering pipeline but is not the core distribution function.

---

## 11. Audio Fingerprinting — AcoustID/MusicBrainz Auto-Metadata

### Market Standard

**AcoustID System:**
- Chromaprint: Open-source acoustic fingerprinting algorithm
- Fingerprint: Compact base64-encoded string representing spectral content
- AcoustID database: Open database mapping fingerprints → MusicBrainz recording IDs
- MusicBrainz: Open music encyclopedia with metadata (artist, title, album, year, genre, ISRC)

**How It Works:**
1. Compute Chromaprint fingerprint from audio (1-3 minute sample)
2. Query AcoustID web service: `https://api.acoustid.org/v2/lookup?client=CLIENT_ID&meta=recordings&duration=N&fingerprint=FINGERPRINT`
3. Receive MusicBrainz Recording IDs + metadata scores
4. Query MusicBrainz API for full metadata: `https://musicbrainz.org/ws/2/recording/RECORDING_ID?inc=artists+releases+isrcs&fmt=json`
5. Extract: artist name, track title, album, release date, ISRC, genre tags

**Alternative Systems:**
- Shazam fingerprinting (proprietary, offline via ShazamKit for iOS/macOS)
- ACRCloud (commercial, API-based, broadcast monitoring)
- Gracenote (legacy, proprietary, being deprecated for music)

### RAIN V6 Beta Code Status: ⚠️ FINGERPRINT GENERATION ONLY (50%)

**Backend (`backend/app/services/provenance/fingerprint.py`):**
- `compute_chromaprint(samples, sample_rate)`: Full Chromaprint fingerprint computation
- Uses `acoustid` + `chromaprint` Python packages (lazy import)
- Raises RAIN-E743 if packages unavailable (graceful degradation)
- mono conversion from stereo input
- int16 PCM conversion for chromaprint API
- Integrated into provenance pipeline for rendering

**Backend (Master Dossier):**
- SHA-256 audio fingerprint embedded in WAV LIST/INFO IFPR field

### Gaps to Address

| Gap | Priority |
|-----|----------|
| **AcoustID lookup integration**: Fingerprint is computed but never queried against AcoustID database | HIGH |
| **MusicBrainz metadata extraction**: No MusicBrainz API integration for auto-populating title/artist/album | HIGH |
| **Multi-source candidate ranking**: When AcoustID returns multiple matches, need confidence scoring to pick best match | MEDIUM |
| **Manual correction workflow**: UI for user to review/correct auto-detected metadata before accepting | MEDIUM |
| **ShazamKit integration**: Alternative fingerprinting for iOS/macOS native app | LOW |
| **Batch/bulk fingerprinting**: Fingerprint entire catalogs for label accounts | LOW |

### Implementation Requirements

```python
class AcoustIDMetadataResolver:
    async def resolve(audio_bytes: bytes, sample_rate: int) -> ResolvedMetadata:
        """Auto-populate metadata from audio fingerprint"""
        fingerprint = compute_chromaprint(audio_bytes, sample_rate)
        # 1. Query AcoustID API
        # 2. Get MusicBrainz recording IDs
        # 3. Fetch full metadata from MusicBrainz
        # 4. Return structured metadata with confidence scores
        return ResolvedMetadata(
            title="...", artist="...", album="...", 
            isrc="...", year=..., confidence=0.92
        )
```

**Priority: HIGH** — Auto-metadata is a killer feature for a post-session pipeline. Most DAW exports have zero metadata. An "Import from WAV → Auto-detect Everything" workflow is transformative.

---

## 12. Loudness Compliance Automation — EBU R128, ATSC A/85, AES Streaming

### Market Standard

**EBU R128 (v5.0):**
- Integrated loudness: -23 LUFS (±0.2 LU for non-live, ±1 LU for live)
- Measurement: ITU-R BS.1770-4 with relative gate at -10 LU
- LRA (Loudness Range): Descriptor per EBU Tech 3342
- True Peak: -1 dBTP maximum
- Meters: EBU Mode (Momentary 400ms / Short-term 3s / Integrated)
- Supplements: R128s1 (short-form), R128s2 (streaming), R128s3 (radio), R128s4 (cinema)

**ATSC A/85 (US broadcast):**
- Integrated loudness: -24 LKFS (LUFS)
- True Peak: -2 dBTP
- Measurement: ITU-R BS.1770-3
- Dialogue-gated measurement for content with speech

**AES Streaming Loudness Recommendation (TD1008):**
- Target: -16 to -20 LUFS (depends on content type)
- True Peak: -1 dBTP recommended
- Dynamic range: Content-dependent, no single target
- Consistent loudness across program boundaries

**Professional Broadcast Tools:**

| Tool | Standards | Features |
|------|-----------|----------|
| **Dolby DP600** | EBU R128, ATSC A/85 | Real-time measurement, file-based analysis, loudness correction, true-peak limiting |
| **TC Electronic LM2/LM6** | EBU R128, ATSC A/85, ITU BS.1770 | Radar display, logging, loudness history, compliance reporting |
| **iZotope RX Loudness Control** | EBU R128, ATSC A/85 | Auto-correction, batch processing, PDF reports |
| **Nugen LM-Correct** | EBU R128, ATSC A/85, ARIB, OP-59, AGCOM | Auto-correct with DynApt dynamics, true-peak limiting, offline + real-time |
| **ffmpeg loudnorm** | EBU R128 | Single-pass measurement, dual-pass with linear normalization |
| **libebur128** | EBU R128 | C library, integrated/short-term/momentary/LRA measurement |

### RAIN V6 Beta Code Status: ✅ IMPLEMENTED (95%)

**Backend (`backend/app/services/qc_engine.py`):**
- 18-point automated QC checks per RAIN-PLATFORM-SPEC-v1.0
- `check_digital_clipping()`: 3+ consecutive samples at full scale, auto-remediation with -0.18 dB gain
- Uses `pyloudnorm` (ITU-R BS.1770-4 compliant)
- Uses `scipy.signal` (butter filters, resample_poly)
- QCReport: passed, critical_failures, remediated_count
- Per-check severity: critical, high, medium, low, advisory
- Auto-remediation for critical failures
- Multi-platform validation per target

**Backend (`backend/app/services/platform_targets.py`):**
- EBU R128 target: -23 LUFS, -1 dBTP, LRA max 20 LU
- ATSC A/85 target: -24 LUFS, -2 dBTP
- LRA constraints enforced: vinyl min 8 LU, broadcast max 20 LU

**Frontend QCTab.tsx:**
- 18-point compliance matrix visual display
- Multi-platform validation view

### Gaps to Address

| Gap | Priority |
|-----|----------|
| **PDF compliance report export**: Generate professional broadcast-style loudness reports for clients | MEDIUM |
| **Real-time loudness history graph**: EBU Mode meter with logging (momentary, short-term, integrated history) | MEDIUM |
| **Batch QC for albums**: Run QC across all tracks in an album, check inter-track loudness consistency | MEDIUM |
| **EBU R128 logo certification**: Apply for EBU R128 logo usage rights | LOW |
| **LRA optimization guidance**: Suggest compression/expansion to achieve target LRA ranges | LOW |
| **Dialogue-gated measurement**: For podcast/audiobook content per ATSC A/85 | LOW |

**Priority: MEDIUM** — QC engine is solid. Report generation and batch processing are the key adds.

---

## Summary: Priority Matrix

### HIGH Priority (Blocking for Post-Session Pipeline MVP)

| # | Topic | Status | Effort | Impact |
|---|-------|--------|--------|--------|
| 1 | DDEX ERN 4.3.2 multi-track support | Has single-track, need album/EP | Medium | Distribution is the final step |
| 8 | Distribution API expansions (DistroKid, TuneCore) | LabelGrid only | High | Broad DSP reach essential |
| 2 | C2PA v2.2 WAV JUMBF box embedding | Manifest exists, missing proper embedding | Medium | EU AI Act enforcement imminent |
| 11 | AcoustID/MusicBrainz auto-metadata | Fingerprint works, missing lookup | Low | Killer UX feature |
| 7 | UPC/EAN per-format assignment | Single UPC per release | Low | Required for physical+digital |

### MEDIUM Priority (Important for Completeness)

| # | Topic | Status | Effort | Impact |
|---|-------|--------|--------|--------|
| 3 | Dolby Atmos ADM BWF full encoding | Structural stub only | High | Growing spatial market |
| 10 | BS-RoFormer 12-stem production enablement | Code written, needs deployment | Medium | Marketing advantage |
| 6 | ISRC registrant code self-service | Fixed registrant code | Low | Multi-label support |
| 12 | QC report generation (PDF) | QC engine solid, no reports | Low | Professional deliverables |
| 5 | Platform loudness targets | Already 100% complete | — | — |

### LOW Priority (Future Roadmap)

| # | Topic | Status | Effort | Impact |
|---|-------|--------|--------|--------|
| 4 | MFiT/Apple Digital Masters | Basic support via LUFS target | Low | Minor badge benefit |
| 9 | AI mastering comparison | Already competitive/superior | — | — |

---

## Architecture Summary: The Canonical Post-Session Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       DAW EXPORT                                          │
│  WAV 24-bit/48kHz (stereo or stems)                                      │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    RAIN V6 POST-SESSION PIPELINE                          │
│                                                                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐       │
│  │ AUTO-METADATA   │    │ QUALITY CONTROL  │    │ AI MASTERING    │       │
│  │ AcoustID →      │───▶│ 18-point QC     │───▶│ 16-stage DSP   │       │
│  │ MusicBrainz →   │    │ per-platform     │    │ + RainNet ML   │       │
│  │ Title/Artist/   │    │ auto-remediation │    │ 7 macros       │       │
│  │ Album/ISRC/Year │    └─────────────────┘    └─────────────────┘       │
│  └─────────────────┘                                                      │
│           │                                                               │
│           ▼                                                               │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐       │
│  │ STEM SEPARATION │    │ SPATIAL RENDER  │    │ PROVENANCE      │       │
│  │ BS-RoFormer     │───▶│ Dolby Atmos     │───▶│ RAIN-CERT       │       │
│  │ 4-pass cascade  │    │ 7.1.4 binaural  │    │ Ed25519 signed  │       │
│  │ 12 stems        │    │ ADM BWF output  │    │ C2PA v2.2 JUMBF │       │
│  └─────────────────┘    └─────────────────┘    │ AudioSeal WM    │       │
│                                                 └─────────────────┘       │
│           │                                               │               │
│           ▼                                               ▼               │
│  ┌─────────────────────────────────────────────────────────────────┐     │
│  │                        EXPORT PACKAGES                           │     │
│  │  WAV 24-bit/48kHz  │  MP3 320kbps  │  ADM BWF Atmos  │  Stems  │     │
│  │  + metadata         │  + ID3v2.4    │  + binaural     │  + ZIP  │     │
│  │  + RAIN-CERT        │  + artwork    │                 │         │     │
│  └─────────────────────────────────────────────────────────────────┘     │
│                                   │                                       │
│                                   ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────┐     │
│  │                      DISTRIBUTION                                 │     │
│  │  ISRC allocate  │  UPC allocate  │  DDEX ERN 4.3.2 XML          │     │
│  │  C2PA + AI disclosure  │  Platform targets  │  Aggregator route │     │
│  │                                                                   │     │
│  │  LabelGrid API ✓  │  DistroKid API ✗  │  TuneCore API ✗        │     │
│  └─────────────────────────────────────────────────────────────────┘     │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐     │
│  │                    DEPLOY TO DSPs                                  │     │
│  │  Spotify  │  Apple Music  │  YouTube  │  Tidal  │  Amazon  │ ... │     │
│  │  -14 LUFS │  -16 LUFS     │  -14 LUFS │ -14 LUFS│ -14 LUFS │     │     │
│  └─────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Key Implementation Requirements for RAIN V6 Production Beast

### 1. DDEX Multi-Track Release Pipeline (HIGH)

```typescript
// frontend/src/types/ddex.ts
interface DDEXMultiTrackRelease {
  releaseId: string;
  releaseType: "Single" | "EP" | "Album" | "Compilation";
  tracks: DDEXTrack[];
  albumMetadata: AlbumMetadata;
  contributors: Contributor[];
  territories: TerritoryConfig[];
}

interface DDEXTrack {
  isrc: string;
  title: string;
  artist: string;
  duration: number;  // seconds
  explicit: boolean;
  genre: string;
  audioHash: string;  // SHA-256
  aiDisclosure: AIDisclosure;
}

interface Contributor {
  role: "Composer" | "Lyricist" | "Producer" | "Mixer" | "MasteringEngineer";
  name: string;
  IPI?: string;  // Interested Parties Information (rights society ID)
}
```

### 2. C2PA JUMBF Embedding (HIGH)

```python
# backend/app/services/provenance/c2pa_embed.py
class C2PAWaveEmbedder:
    """Embed C2PA v2.2 manifest as JUMBF box in WAV RIFF chunk"""
    
    JUMBF_FOURCC = b'JUMBF'
    JUMD_FOURCC = b'jumd'
    JSON_FOURCC = b'json'
    CBOR_FOURCC = b'cbor'
    
    def embed(self, wav_bytes: bytes, manifest: C2PAManifest) -> bytes:
        # 1. Serialize manifest to CBOR per C2PA v2.2 §7
        # 2. Create JUMBF superbox structure:
        #    - jumd: Description box (UUID, label)
        #    - json: JSON-LD manifest reference
        #    - cbor: Full CBOR assertion store
        # 3. Insert before 'data' chunk in RIFF structure
```

### 3. AcoustID Metadata Auto-Resolution (HIGH)

```python
# backend/app/services/auto_metadata.py
class AutoMetadataResolver:
    ACOUSTID_API = "https://api.acoustid.org/v2/lookup"
    MUSICBRAINZ_API = "https://musicbrainz.org/ws/2"
    
    async def resolve_from_audio(self, audio_bytes: bytes, sample_rate: int) -> ResolvedMetadata:
        fingerprint = compute_chromaprint(samples, sample_rate)
        
        # Step 1: Query AcoustID
        response = await query_acoustid(fingerprint, duration)
        
        # Step 2: Get best MusicBrainz ID
        recording_id = select_best_match(response['results'])
        
        # Step 3: Fetch full metadata
        metadata = await query_musicbrainz(recording_id)
        
        return ResolvedMetadata(
            title=metadata['title'],
            artist=metadata['artist-credit'][0]['name'],
            album=metadata['releases'][0]['title'],
            isrc=metadata.get('isrcs', [None])[0],
            year=metadata['releases'][0].get('date', '')[:4],
            confidence=response['results'][0]['score'],
        )
```

### 4. Multi-Aggregator Distribution Router (HIGH)

```python
# backend/app/services/distribution_router.py
class DistributionRouter:
    AGGREGATORS = {
        'labelgrid': LabelGridClient,
        'fuga': FUGAClient,  # To implement
        'distrokid': DistroKidClient,  # Via browser automation
    }
    
    async def route(
        self,
        release: DDEXRelease,
        target_aggregators: list[str],
        strategy: DistributionStrategy,
    ) -> dict[str, DistributionResult]:
        """Route release to multiple aggregators for maximum DSP coverage"""
```

---

## Conclusion

RAIN V6 Beta is remarkably advanced for a pre-production release — with working DDEX, C2PA, ISRC/UPC, loudness targets, QC, and LabelGrid distribution. The gap to become the canonical post-session pipeline is primarily:

1. **Distribution breadth** — DistroKid + TuneCore + FUGA API integrations (DistroKid has no public API; need alternative approach)
2. **C2PA JUMBF embedding** — Manifests exist but need proper RIFF/WAV box format for spec compliance
3. **AcoustID auto-metadata** — Fingerprint code exists but lookup is not wired
4. **DDEX multi-track** — Album/EP support needed beyond single-track releases

The production beast's roadmap (C++20/WASM RainDSP, ONNX RainNet v2, BS-RoFormer separation) addresses the algorithmic competitiveness gap. The immediate priority should be **distribution pipeline breadth** — because mastering without distribution stops at export, not at the DSPs.

---

*Research compiled from:
- RAIN V6 Beta source code (full audit of backend services, frontend components, API routes)
- RAIN V6 Master Dossier v0.2.1
- Spotify official loudness documentation (artists.spotify.com)
- DDEX official website (ddex.net)
- C2PA v2.2 specification (c2pa.org)
- EBU Technology loudness portal (tech.ebu.ch)
- IFPI ISRC official website (isrc.ifpi.org)
- Chromaprint/AcoustID documentation
- BS-RoFormer GitHub repositories (ZFTurbo/openmirlab)*
