/**
 * RAIN V6 — DDEX ERN 4.3.2 Multi-Track Release Builder
 *
 * Extends distribution.ts with full album/EP/compilation support.
 * buildDdexErnXml() handles single tracks; this module handles multi-track
 * releases with proper ResourceList, ReleaseResourceReferenceList, and
 * per-track metadata per the DDEX ERN 4.3.2 schema.
 *
 * Integration: call buildMultiTrackDdexXml() from DistributeTab when the
 * user has selected > 1 track for a release.
 *
 * ⚠️  ISRC/UPC LOCAL IDENTIFIERS ONLY — see provenance.ts for warning.
 */

import { buildDdexErnXml, validateDdex, escapeXml, type DdexMetadata } from './distribution'

// ---------------------------------------------------------------------------
// Multi-track types
// ---------------------------------------------------------------------------

export interface MultiTrackMetadata {
  /** Per-track metadata. Must have at least 1 entry. */
  tracks: Array<{
    /** Unique per-track ISRC. */
    isrc: string
    /** Track title. */
    title: string
    /** Track artist (falls back to album artist if omitted). */
    artist?: string
    /** Track duration in seconds. */
    durationSeconds: number
    /** Track number (1-based). */
    trackNumber: number
    /** Disc number for multi-disc releases (defaults to 1). */
    discNumber?: number
    /** Per-track genre override. */
    genre?: string
    /** Per-track explicit lyrics flag. */
    explicitLyrics?: 'none' | 'explicit' | 'clean'
    /** Per-track AI disclosure. */
    aiDisclosure?: Record<string, 'none' | 'assisted' | 'generated'>
    /** Per-track contributors. */
    contributors?: Array<{
      name: string
      role: string
      ipi?: string
      isni?: string
      share?: number
    }>
    /** Per-track ISWC. */
    iswc?: string
    /** Audio asset SHA-256 for this track's master file. */
    audioHash?: string
  }>

  /** Release-level metadata (shared across all tracks). */
  release: {
    /** Global UPC/EAN for the release. */
    upc: string
    /** Release title (album/EP name). */
    title: string
    /** Primary release artist. */
    artist: string
    /** Release type. */
    releaseType: 'single' | 'ep' | 'album' | 'compilation'
    /** Genre (DDEX descriptor). */
    genre?: string
    /** DDEX genre:subgenre. */
    genreSubgenre?: string
    /** ISO-8601 release date. */
    releaseDate?: string
    /** Original release date for re-releases. */
    originalReleaseDate?: string
    /** Year of original release. */
    year?: string
    /** Label name. */
    label?: string
    /** Distributor name. */
    distributor?: string
    /** P-line holder (sound recording copyright). */
    pLine?: string
    /** C-line (composition copyright). */
    cLine?: string
    /** Publisher name. */
    publisher?: string
    /** PRO / collecting society. */
    pro?: string
    /** Master rights owner. */
    masterOwner?: string
    /** ISO 639-2 language code. */
    language?: string
    /** Explicit content flag for the release as a whole. */
    explicitLyrics?: 'none' | 'explicit' | 'clean'
    /** Parental advisory. */
    parentalAdvisory?: boolean
    /** Territories (ISO 3166 codes or ['WORLDWIDE']). */
    territories?: string[]
    /** Target DSP slugs. */
    targetDsps?: string[]
    /** DSP display labels. */
    dspLabels?: Record<string, string>
    /** Release-level AI disclosure (overridden per-track if provided). */
    aiDisclosure?: Record<string, 'none' | 'assisted' | 'generated'>
    /** Release-level contributors (composers, producers, etc.). */
    contributors?: Array<{
      name: string
      role: string
      ipi?: string
      isni?: string
      share?: number
    }>
  }
}

export interface MultiTrackDdexValidation extends ReturnType<typeof validateDdex> {
  trackValidations: Array<{ trackIndex: number; isrc: string; ok: boolean; errors: string[] }>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoDurationFromSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `PT${m}M${r}S`
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** Build a single SoundRecording XML block for one track. */
function buildSoundRecordingXml(
  track: MultiTrackMetadata['tracks'][0],
  refId: string,
  fallbackArtist: string,
): string {
  const title = escapeXml(track.title)
  const artist = escapeXml(track.artist || fallbackArtist)
  const iswcBlock = track.iswc
    ? `      <ISWC>${escapeXml(track.iswc)}</ISWC>\n`
    : ''
  const duration = isoDurationFromSeconds(track.durationSeconds)

  const contributorsBlock = (track.contributors && track.contributors.length > 0)
    ? track.contributors
        .map((c) => {
          const ipi = c.ipi ? `\n        <IPI>${escapeXml(c.ipi)}</IPI>` : ''
          const isni = c.isni ? `\n        <ISNI>${escapeXml(c.isni)}</ISNI>` : ''
          const share = typeof c.share === 'number' && !Number.isNaN(c.share)
            ? `\n        <Share>${c.share}</Share>`
            : ''
          return `      <ResourceContributor>\n        <PartyName><FullName>${escapeXml(c.name || '')}</FullName></PartyName>\n        <Role>${escapeXml(c.role)}</Role>${ipi}${isni}${share}\n      </ResourceContributor>`
        })
        .join('\n')
    : ''

  const explicitBlock = track.explicitLyrics
    ? `    <ParentalWarningType>${track.explicitLyrics === 'explicit' ? 'Explicit' : track.explicitLyrics === 'clean' ? 'Cleaned' : 'NotExplicit'}</ParentalWarningType>\n`
    : ''

  const genreBlock = track.genre
    ? `    <Genre>${escapeXml(track.genre)}</Genre>\n`
    : ''

  const aiDisclosure = track.aiDisclosure ?? {}
  const disclosureFields = ['vocals', 'instrumentation', 'composition', 'mixing', 'mastering']
  const disclosureBlock = disclosureFields
    .map((f) => `      <${f}>${aiDisclosure[f] ?? 'none'}</${f}>`)
    .join('\n')

  return `    <SoundRecording>
      <ResourceReference>${refId}</ResourceReference>
      <ISRC>${escapeXml(track.isrc)}</ISRC>
${iswcBlock}      <ReferenceTitle>${title}</ReferenceTitle>
      <Duration>${duration}</Duration>
      <DisplayArtist>
        <PartyName><FullName>${artist}</FullName></PartyName>
      </DisplayArtist>
${explicitBlock}${genreBlock}      <AIInvolvement>
${disclosureBlock}
      </AIInvolvement>
${contributorsBlock ? `      <ResourceContributorList>\n${contributorsBlock}\n      </ResourceContributorList>\n` : ''}    </SoundRecording>`
}

/** Build the ReleaseResourceReferenceList block linking release to all tracks. */
function buildReleaseResourceReferenceList(
  tracks: MultiTrackMetadata['tracks'],
): string {
  const refs = tracks.map((_, i) => {
    const refId = `A${(i + 1).toString().padStart(1, '0')}`
    return `      <ReleaseResourceReference>
        <ResourceReference>${refId}</ResourceReference>
        <SequenceNumber>${i + 1}</SequenceNumber>
      </ReleaseResourceReference>`
  }).join('\n')

  return `    <ReleaseResourceReferenceList>
${refs}
    </ReleaseResourceReferenceList>`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a DDEX ERN 4.3.2 NewReleaseMessage for a multi-track release
 * (album, EP, compilation, or multi-track single).
 *
 * Produces a proper ResourceList with one SoundRecording per track,
 * a ReleaseResourceReferenceList linking release to all recordings,
 * Deal blocks per DSP, and full metadata across all tracks.
 *
 * @param meta — Multi-track metadata with per-track ISRCs and release-level UPC.
 * @returns Complete DDEX ERN 4.3.2 XML string. Throws if tracks array is empty.
 */
export function buildMultiTrackDdexXml(meta: MultiTrackMetadata): string {
  if (!meta.tracks || meta.tracks.length === 0) {
    throw new Error('Multi-track DDEX requires at least 1 track')
  }

  const messageId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `rain-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const created = new Date().toISOString()

  const release = meta.release
  const releaseTitle = escapeXml(release.title || 'Untitled Release')
  const releaseArtist = escapeXml(release.artist || 'Various Artists')
  const genre = escapeXml(release.genre || '')
  const genreSub = release.genreSubgenre ? escapeXml(release.genreSubgenre) : ''
  const upc = escapeXml(release.upc)
  const releaseDate = release.releaseDate || new Date().toISOString().slice(0, 10)
  const year = escapeXml(release.year || String(new Date().getFullYear()))

  // Optional release-level blocks
  const releaseTypeBlock = release.releaseType
    ? `    <ReleaseType>${release.releaseType}</ReleaseType>\n`
    : ''
  const pLineBlock = release.pLine
    ? `    <PLine>${escapeXml(release.pLine)}</PLine>\n`
    : ''
  const cLineBlock = release.cLine
    ? `    <CLine>${escapeXml(release.cLine)}</CLine>\n`
    : ''
  const labelBlock = release.label
    ? `    <LabelName>${escapeXml(release.label)}</LabelName>\n`
    : ''
  const distributorBlock = release.distributor
    ? `    <DistributorName>${escapeXml(release.distributor)}</DistributorName>\n`
    : `    <DistributorName>RAIN V6</DistributorName>\n`
  const languageBlock = release.language
    ? `    <LanguageOfPerformance>${escapeXml(release.language)}</LanguageOfPerformance>\n`
    : ''
  const explicitBlock = release.explicitLyrics
    ? `    <ParentalWarningType>${release.explicitLyrics === 'explicit' ? 'Explicit' : release.explicitLyrics === 'clean' ? 'Cleaned' : 'NotExplicit'}</ParentalWarningType>\n`
    : ''
  const publisherBlock = release.publisher
    ? `    <Publisher><PartyName><FullName>${escapeXml(release.publisher)}</FullName></PartyName>${release.pro ? `<PRO>${escapeXml(release.pro)}</PRO>` : ''}</Publisher>\n`
    : ''
  const masterOwnerBlock = release.masterOwner
    ? `    <MasterOwner>${escapeXml(release.masterOwner)}</MasterOwner>\n`
    : ''
  const territoriesBlock = release.territories && release.territories.length > 0
    ? `    <TerritoryCode>${release.territories.map(escapeXml).join('</TerritoryCode>\n    <TerritoryCode>')}</TerritoryCode>\n`
    : ''

  // Release-level AI disclosure
  const relAi = release.aiDisclosure ?? {}
  const disclosureFields = ['vocals', 'instrumentation', 'composition', 'mixing', 'mastering']
  const disclosureBlock = disclosureFields
    .map((f) => `      <${f}>${relAi[f] ?? 'none'}</${f}>`)
    .join('\n')

  // Release-level contributors
  const relContributorsBlock = (release.contributors && release.contributors.length > 0)
    ? release.contributors
        .map((c) => {
          const ipi = c.ipi ? `\n        <IPI>${escapeXml(c.ipi)}</IPI>` : ''
          const isni = c.isni ? `\n        <ISNI>${escapeXml(c.isni)}</ISNI>` : ''
          const share = typeof c.share === 'number' && !Number.isNaN(c.share)
            ? `\n        <Share>${c.share}</Share>`
            : ''
          return `      <ResourceContributor>\n        <PartyName><FullName>${escapeXml(c.name || '')}</FullName></PartyName>\n        <Role>${escapeXml(c.role)}</Role>${ipi}${isni}${share}\n      </ResourceContributor>`
        })
        .join('\n')
    : ''

  // Track SoundRecordings
  const soundRecordings = meta.tracks
    .map((track, i) => {
      const refId = `A${(i + 1).toString().padStart(1, '0')}`
      return buildSoundRecordingXml(track, refId, releaseArtist)
    })
    .join('\n\n')

  // ReleaseResourceReferenceList
  const releaseRefList = buildReleaseResourceReferenceList(meta.tracks)

  // Deal blocks
  const dsps = release.targetDsps && release.targetDsps.length > 0
    ? release.targetDsps
    : ['spotify', 'apple_music', 'youtube', 'tidal']
  const dealBlock = dsps
    .map((slug) => {
      const label = release.dspLabels?.[slug]
        ? escapeXml(release.dspLabels[slug])
        : escapeXml(slug)
      return `    <Deal>\n      <DSPName>${label}</DSPName>\n      <CommercialModel>PayAsYouGo</CommercialModel>\n    </Deal>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<ern:NewReleaseMessage xmlns:ern="http://ddex.net/xml/ern/43" LanguageAndScriptCode="en">
  <MessageHeader>
    <MessageId>${messageId}</MessageId>
    <MessageCreatedDateTime>${created}</MessageCreatedDateTime>
    <MessageSender>
      <PartyName><FullName>RAIN V6 Studio</FullName></PartyName>
    </MessageSender>
  </MessageHeader>
  <ResourceList>
${soundRecordings}
  </ResourceList>
  <Release>
    <ReleaseId>
      <UPC>${upc}</UPC>
    </ReleaseId>
    <ReferenceTitle>${releaseTitle}</ReferenceTitle>
    <DisplayArtist>
      <PartyName>
        <FullName>${releaseArtist}</FullName>
      </PartyName>
    </DisplayArtist>
${releaseTypeBlock}${pLineBlock}${cLineBlock}${labelBlock}${distributorBlock}${languageBlock}${explicitBlock}    <Genre>${genre}</Genre>
${genreSub ? `    <SubGenre>${genreSub}</SubGenre>\n` : ''}    <YearOfOriginalRelease>${year}</YearOfOriginalRelease>
    <ReleaseDate>${releaseDate}</ReleaseDate>
${publisherBlock}${masterOwnerBlock}${territoriesBlock}    <AIInvolvement>
${disclosureBlock}
    </AIInvolvement>
${relContributorsBlock ? `    <ResourceContributorList>\n${relContributorsBlock}\n    </ResourceContributorList>\n` : ''}
${releaseRefList}
  </Release>
  <DealList>
${dealBlock}
  </DealList>
</ern:NewReleaseMessage>`
}

/**
 * Convenience: build a multi-track DDEX XML and validate it in one call.
 * Returns both the XML string and validation results.
 */
export function buildAndValidateMultiTrackDdex(
  meta: MultiTrackMetadata,
): { xml: string; valid: boolean; errors: string[] } {
  let xml: string
  try {
    xml = buildMultiTrackDdexXml(meta)
  } catch (e) {
    return {
      xml: '',
      valid: false,
      errors: [e instanceof Error ? e.message : 'Failed to build DDEX XML'],
    }
  }

  const validation = validateDdex(xml)
  return { xml, valid: validation.ok, errors: validation.errors }
}

/**
 * Build a distribution package for a multi-track release.
 * Single-track convenience that wraps the single-track builder; for multi-track
 * releases, use the Distribute tab which calls buildMultiTrackDdexXml directly
 * and assembles the ZIP with per-track WAV/MP3 assets.
 *
 * This function exists so callers don't need to know whether they're dealing
 * with a single track or multi-track — it routes correctly.
 */
export function buildDdexXmlAuto(
  meta: DdexMetadata | MultiTrackMetadata,
): string {
  if ('tracks' in meta) {
    return buildMultiTrackDdexXml(meta as MultiTrackMetadata)
  }
  return buildDdexErnXml(meta as DdexMetadata)
}
