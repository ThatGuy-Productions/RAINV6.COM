'use client'

/**
 * RAIN V6 — Ditto-standard release metadata form.
 *
 * Single source of truth for everything the DDEX ERN 4.3.2 manifest, the
 * RAIN-CERT provenance cert, and the ID3/RIFF embedded tags need to know
 * about a release. Reads + writes the Zustand `metadata` slice directly
 * (auto-saves on every keystroke); the "Save to release" button is just a
 * visual confirmation toast.
 *
 * Sections (accordion, all expanded by default on desktop):
 *   1. Release Information
 *   2. Track Information
 *   3. Copyright & Publishing
 *   4. Contributors / Credits  (table with add/remove rows)
 *   5. AI Disclosure           (5-row × 3-column grid)
 *   6. Release Notes / Comments
 *
 * Sticky top toolbar: live validation badge, "Generate ISRC + UPC",
 * "Save to release" (toast), "Reset" (confirm dialog).
 *
 * Visual language: dark rain-panel/rain-surface-2, lime accent, font-mono
 * uppercase labels, subtle Framer Motion entrance.
 */

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  ListChecks,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Field, TextAreaField } from './Field'
import { SelectField } from './SelectField'
import { RadioField } from './RadioField'
import { useSessionStore } from '@/lib/rain/store'
import { generateIsrc, generateUpc } from '@/lib/rain/provenance'
import { notifySuccess, notifyInfo, notifyWarning } from '@/lib/rain/notifications'
import {
  CONTRIBUTOR_ROLE_OPTIONS,
  GENRE_SUBGENRE_OPTIONS,
  LANGUAGE_OPTIONS,
  PRO_OPTIONS,
  TERRITORY_OPTIONS,
  WRITER_ROLES,
  validateIsrc,
  validateIswc,
  validateMetadata,
  validateUpc,
} from '@/lib/rain/metadata-validation'
import type {
  AiDisclosure,
  Contributor,
  ContributorRole,
  TrackMetadata,
} from '@/lib/rain/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DISCLOSURE_FIELDS: { key: keyof AiDisclosure; label: string; tooltip: string }[] = [
  { key: 'vocals', label: 'Vocals', tooltip: 'Lead + backing vocal performances. Generated = AI voice clone or synth voice.' },
  { key: 'instrumentation', label: 'Instrumentation', tooltip: 'Instrumental performances. Generated = MIDI rendered by an AI instrument model.' },
  { key: 'composition', label: 'Composition', tooltip: 'The underlying musical work (melody + harmony). Generated = AI-composed.' },
  { key: 'mixing', label: 'Mixing', tooltip: 'Mix balance + automation. Assisted = AI tools used as one input among many.' },
  { key: 'mastering', label: 'Mastering', tooltip: 'Final loudness + colour. RAIN V6 mastering is AI-assisted by default.' },
]

function issueForField(issues: { field: string; message: string }[], field: string): string | undefined {
  return issues.find((i) => i.field === field || i.field.startsWith(field + '.'))?.message
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MetadataForm() {
  const metadata = useSessionStore((s) => s.metadata)
  const setMetadata = useSessionStore((s) => s.setMetadata)
  const reset = useSessionStore((s) => s.reset)

  const [resetOpen, setResetOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // ---- Live validation ----
  const issues = React.useMemo(() => validateMetadata(metadata), [metadata])
  const issueCount = issues.length
  const ready = issueCount === 0

  // ---- Update helpers (each writes through the Zustand shallow-merge) ----
  const update = React.useCallback(
    (patch: Partial<TrackMetadata>) => setMetadata(patch),
    [setMetadata],
  )

  const updateDisclosure = React.useCallback(
    (key: keyof AiDisclosure, value: 'none' | 'assisted' | 'generated') => {
      setMetadata({
        aiDisclosure: { ...(metadata.aiDisclosure as AiDisclosure), [key]: value },
      })
    },
    [metadata.aiDisclosure, setMetadata],
  )

  // ---- Featured-artists parsing: comma-separated string → contributors[] ----
  // We reconcile the contributors array: featured-artist rows that were auto-
  // generated from the input are removed and re-added whenever the string
  // changes, preserving user-added rows for other roles.
  const featuredString = React.useMemo(
    () => (metadata.contributors ?? [])
      .filter((c) => c.role === 'featured')
      .map((c) => c.name)
      .join(', '),
    [metadata.contributors],
  )

  const setFeaturedArtists = React.useCallback(
    (raw: string) => {
      const names = raw.split(',').map((s) => s.trim()).filter(Boolean)
      const nonFeatured = (metadata.contributors ?? []).filter((c) => c.role !== 'featured')
      const featured: Contributor[] = names.map((name) => ({ name, role: 'featured' }))
      setMetadata({ contributors: [...nonFeatured, ...featured] })
    },
    [metadata.contributors, setMetadata],
  )

  // ---- Auto-populate: when primary artist changes and there's no performer row, add one ----
  const ensurePerformer = React.useCallback(
    (artist: string) => {
      const existing = (metadata.contributors ?? []).find((c) => c.role === 'performer')
      if (existing) {
        // Update the existing performer's name (don't add a duplicate).
        const next = (metadata.contributors ?? []).map((c) =>
          c.role === 'performer' ? { ...c, name: artist } : c,
        )
        setMetadata({ contributors: next })
      } else if (artist.trim()) {
        setMetadata({
          contributors: [{ name: artist, role: 'performer' }, ...(metadata.contributors ?? [])],
        })
      }
    },
    [metadata.contributors, setMetadata],
  )

  // ---- Contributor row operations ----
  const addContributor = React.useCallback(() => {
    const next: Contributor[] = [
      ...(metadata.contributors ?? []),
      { name: '', role: 'songwriter', share: undefined },
    ]
    setMetadata({ contributors: next })
  }, [metadata.contributors, setMetadata])

  const updateContributor = React.useCallback(
    (index: number, patch: Partial<Contributor>) => {
      const next = (metadata.contributors ?? []).map((c, i) =>
        i === index ? { ...c, ...patch } : c,
      )
      setMetadata({ contributors: next })
    },
    [metadata.contributors, setMetadata],
  )

  const removeContributor = React.useCallback(
    (index: number) => {
      const next = (metadata.contributors ?? []).filter((_, i) => i !== index)
      setMetadata({ contributors: next })
    },
    [metadata.contributors, setMetadata],
  )

  // ---- Writer share total ----
  const writerShareTotal = React.useMemo(() => {
    return (metadata.contributors ?? [])
      .filter((c) => WRITER_ROLES.includes(c.role))
      .reduce((sum, c) => sum + (typeof c.share === 'number' && !Number.isNaN(c.share) ? c.share : 0), 0)
  }, [metadata.contributors])

  // ---- Re-release toggle ----
  const [isRerelease, setIsRerelease] = React.useState(Boolean(metadata.originalReleaseDate))

  // ---- Genre:Subgenre parsing (combined "Genre:Subgenre" string in metadata.genreSubgenre) ----
  const [selectedGenre, selectedSubgenre] = React.useMemo(() => {
    const v = metadata.genreSubgenre ?? ''
    const [g, s] = v.split(':')
    return [g ?? '', s ?? '']
  }, [metadata.genreSubgenre])

  const setGenreSubgenre = React.useCallback(
    (genre: string, subgenre: string) => {
      update({
        genreSubgenre: subgenre ? `${genre}:${subgenre}` : genre,
        // Also keep the legacy `genre` field in sync (top-level only).
        genre: genre.toLowerCase(),
      })
    },
    [update],
  )

  // ---- Territories multi-select ----
  const toggleTerritory = React.useCallback(
    (code: string) => {
      const current = metadata.territories ?? []
      // If 'WORLDWIDE' is in the list and the user picks a specific country,
      // remove 'WORLDWIDE' (mutually exclusive intent).
      let next: string[]
      if (current.includes(code)) {
        next = current.filter((c) => c !== code)
      } else {
        next = code === 'WORLDWIDE'
          ? ['WORLDWIDE']
          : [...current.filter((c) => c !== 'WORLDWIDE'), code]
      }
      if (next.length === 0) next = ['WORLDWIDE'] // never empty
      update({ territories: next })
    },
    [metadata.territories, update],
  )

  // ---- Toolbar actions ----
  const handleGenerateIds = React.useCallback(() => {
    update({ isrc: generateIsrc(), upc: generateUpc() })
    notifyInfo('Identifiers generated', 'ISRC + UPC populated with valid check digits.')
  }, [update])

  const handleSave = React.useCallback(() => {
    setSaving(true)
    // The store is already up to date (auto-save). This is just a
    // visual confirmation + a brief saving indicator for UX.
    setTimeout(() => {
      setSaving(false)
      if (ready) {
        notifySuccess('Metadata saved', 'Release metadata is valid and ready for distribution.')
      } else {
        notifyWarning(
          'Metadata saved with issues',
          `${issueCount} validation issue${issueCount === 1 ? '' : 's'} remain — review before distributing.`,
        )
      }
    }, 350)
  }, [ready, issueCount])

  const handleReset = React.useCallback(() => {
    reset()
    setResetOpen(false)
    notifyInfo('Metadata reset', 'All fields restored to defaults.')
  }, [reset])

  // ---- Auto-suggest P-line holder from artist + copyrightYear ----
  const suggestPline = React.useCallback(() => {
    const yr = metadata.copyrightYear || String(new Date().getFullYear())
    const who = metadata.artist || metadata.copyrightHolder || ''
    if (who) update({ copyrightHolder: `${yr} ${who}` })
  }, [metadata.artist, metadata.copyrightHolder, metadata.copyrightYear, update])

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const disclosureHasGenerated = React.useMemo(() => {
    const d = metadata.aiDisclosure
    if (!d) return false
    return (Object.values(d) as string[]).some((v) => v === 'generated')
  }, [metadata.aiDisclosure])

  // Accordion value state — all expanded by default.
  const [accordionValue, setAccordionValue] = React.useState<string[]>([
    'release', 'track', 'copyright', 'contributors', 'ai', 'notes',
  ])

  return (
    <div className="space-y-3">
      {/* ----------------------------------------------------------------- */}
      {/* Sticky toolbar                                                    */}
      {/* ----------------------------------------------------------------- */}
      <div
        className="sticky top-0 z-20 -mx-4 px-4 py-2.5 mb-3 backdrop-blur-xl bg-[rgba(10,12,18,0.85)] border-b border-rain-border"
        style={{ boxShadow: '0 4px 16px -8px rgba(0,0,0,0.5)' }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 mr-auto">
            <ListChecks className="w-4 h-4 text-rain-accent" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Validation
            </span>
            <Badge
              variant="outline"
              className={
                ready
                  ? 'border-rain-accent/50 text-rain-accent bg-rain-accent/10'
                  : 'border-amber-400/50 text-amber-400 bg-amber-400/10'
              }
            >
              {ready ? (
                <>
                  <CheckCircle2 className="w-3 h-3" />
                  Ready
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3 h-3" />
                  {issueCount} issue{issueCount === 1 ? '' : 's'}
                </>
              )}
            </Badge>
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleGenerateIds}
            className="bg-rain-surface-2 border-rain-border hover:border-rain-accent/50 hover:text-rain-accent font-mono text-[11px]"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Generate ISRC + UPC
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="bg-rain-accent text-black hover:bg-rain-accent/90 font-mono text-[11px]"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save to release
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setResetOpen(true)}
            className="bg-rain-surface-2 border-rain-border hover:border-red-400/50 hover:text-red-400 font-mono text-[11px]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </Button>
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Accordion form                                                    */}
      {/* ----------------------------------------------------------------- */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <Accordion
          type="multiple"
          value={accordionValue}
          onValueChange={setAccordionValue}
          className="rain-panel rounded-lg px-4"
        >
          {/* ----------------------------------------------------------- */}
          {/* 1. Release Information                                       */}
          {/* ----------------------------------------------------------- */}
          <AccordionItem value="release" className="border-rain-border">
            <AccordionTrigger className="text-sm font-mono uppercase tracking-wider text-rain-accent hover:no-underline">
              <span className="flex items-center gap-2">
                <span className="text-[9px] text-muted-foreground">01</span>
                Release Information
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid lg:grid-cols-2 gap-3 pb-2">
                <Field
                  label="Release Title"
                  value={metadata.title}
                  onValueChange={(v) => update({ title: v })}
                  required
                  placeholder="e.g. Midnight Protocol"
                  error={issueForField(issues, 'title')}
                  warning={!metadata.title ? 'Required' : undefined}
                />
                <Field
                  label="Primary Artist"
                  value={metadata.artist}
                  onValueChange={(v) => {
                    update({ artist: v })
                    ensurePerformer(v)
                  }}
                  required
                  placeholder="e.g. GLM Collective"
                  error={issueForField(issues, 'artist')}
                  warning={!metadata.artist ? 'Required' : undefined}
                />

                <RadioField
                  label="Release Type"
                  value={metadata.releaseType ?? 'single'}
                  onValueChange={(v) => update({ releaseType: v as TrackMetadata['releaseType'] })}
                  layout="grid"
                  options={[
                    { value: 'single', label: 'Single' },
                    { value: 'ep', label: 'EP' },
                    { value: 'album', label: 'Album' },
                    { value: 'compilation', label: 'Compilation' },
                  ]}
                  hint="Drives DDEX <ReleaseType> + DSP categorisation."
                />

                <Field
                  label="Featured Artists"
                  value={featuredString}
                  onValueChange={setFeaturedArtists}
                  placeholder="Comma-separated — added as contributors with role 'featured'"
                  hint="Parsed into the Contributors table with role 'featured'."
                  containerClassName="lg:col-span-2"
                />

                <Field
                  label="Label"
                  value={metadata.label ?? ''}
                  onValueChange={(v) => update({ label: v })}
                  placeholder="Record label name (optional)"
                />
                <Field
                  label="Distributor"
                  value={metadata.distributor ?? ''}
                  onValueChange={(v) => update({ distributor: v })}
                  placeholder="RAIN V6"
                  hint="Default 'RAIN V6' — change if delivering through a different aggregator."
                />

                <Field
                  label="Release Date"
                  type="date"
                  value={metadata.releaseDate ?? ''}
                  onValueChange={(v) => update({ releaseDate: v })}
                  error={issueForField(issues, 'releaseDate')}
                  hint="Official release date — drives the DDEX <ReleaseDate> element."
                />
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      Re-release?
                    </label>
                    <Switch
                      checked={isRerelease}
                      onCheckedChange={(checked) => {
                        setIsRerelease(checked)
                        if (!checked) update({ originalReleaseDate: '' })
                      }}
                    />
                  </div>
                  {isRerelease && (
                    <Field
                      label="Original Release Date"
                      type="date"
                      value={metadata.originalReleaseDate ?? ''}
                      onValueChange={(v) => update({ originalReleaseDate: v })}
                      error={issueForField(issues, 'originalReleaseDate')}
                      containerClassName="mt-1"
                    />
                  )}
                  {!isRerelease && (
                    <div className="text-[9px] font-mono text-muted-foreground/70">
                      Toggle on if this is a re-release of previously-released material.
                    </div>
                  )}
                </div>

                {/* Territories multi-select */}
                <div className="flex flex-col gap-1 lg:col-span-2">
                  <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Territories
                  </label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="w-full bg-rain-surface-2 border border-rain-border rounded-md px-2 py-1.5 text-xs font-mono text-left flex items-center justify-between hover:border-rain-accent/40 transition-colors"
                      >
                        <span className="truncate">
                          {(metadata.territories ?? []).length === 0
                            ? '— none —'
                            : (metadata.territories ?? ['WORLDWIDE']).join(', ')}
                        </span>
                        <span className="text-[9px] text-muted-foreground">
                          {(metadata.territories ?? []).length} selected
                        </span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-80 bg-rain-surface-2 border-rain-border p-2 max-h-80 overflow-y-auto rain-scrollbar"
                      align="start"
                    >
                      <div className="grid grid-cols-1 gap-1">
                        {TERRITORY_OPTIONS.map((t) => (
                          <label
                            key={t.value}
                            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-rain-accent/10 cursor-pointer text-xs font-mono"
                          >
                            <Checkbox
                              checked={(metadata.territories ?? []).includes(t.value)}
                              onCheckedChange={() => toggleTerritory(t.value)}
                            />
                            <span className="text-rain-accent/80 w-10">{t.value === 'WORLDWIDE' ? 'WW' : t.value}</span>
                            <span className="text-foreground/90">{t.label}</span>
                          </label>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <div className="text-[9px] font-mono text-muted-foreground/70">
                    Default Worldwide. Picking specific countries removes Worldwide.
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* ----------------------------------------------------------- */}
          {/* 2. Track Information                                         */}
          {/* ----------------------------------------------------------- */}
          <AccordionItem value="track" className="border-rain-border">
            <AccordionTrigger className="text-sm font-mono uppercase tracking-wider text-rain-accent hover:no-underline">
              <span className="flex items-center gap-2">
                <span className="text-[9px] text-muted-foreground">02</span>
                Track Information
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid lg:grid-cols-2 gap-3 pb-2">
                <Field
                  label="Track Title"
                  value={metadata.title}
                  onValueChange={(v) => update({ title: v })}
                  required
                  placeholder="Defaults from Release Title for singles"
                  error={issueForField(issues, 'title')}
                  containerClassName="lg:col-span-2"
                />

                <div className="grid grid-cols-2 gap-2">
                  <Field
                    label="Track Number"
                    value={metadata.trackNumber}
                    onValueChange={(v) => update({ trackNumber: v })}
                    placeholder="1"
                    error={issueForField(issues, 'trackNumber')}
                  />
                  <Field
                    label="Track Total"
                    value={metadata.trackTotal ?? ''}
                    onValueChange={(v) => update({ trackTotal: v })}
                    placeholder="1"
                    hint="Total tracks in this release."
                    error={issueForField(issues, 'trackTotal')}
                  />
                </div>
                <Field
                  label="Volume / Disc Number"
                  value={metadata.trackVolume ?? ''}
                  onValueChange={(v) => update({ trackVolume: v })}
                  placeholder="1"
                  hint="For multi-disc releases."
                  error={issueForField(issues, 'trackVolume')}
                />

                {/* ISRC with Generate button */}
                <Field
                  label="ISRC"
                  value={metadata.isrc}
                  onValueChange={(v) => update({ isrc: v })}
                  placeholder="US-XXX-YY-NNNNN"
                  hint="ISO 3901 — CC-XXX-YY-NNNNN. Generate or paste existing."
                  error={metadata.isrc && !validateIsrc(metadata.isrc) ? 'ISRC must match CC-XXX-YY-NNNNN.' : issueForField(issues, 'isrc')}
                  warning={!metadata.isrc ? 'Recommended — generate if you don\'t have one' : undefined}
                  suffix={
                    <button
                      type="button"
                      onClick={() => update({ isrc: generateIsrc() })}
                      className="px-2 py-1 rounded-md border border-rain-border bg-rain-surface-2 hover:border-rain-accent/50 text-[10px] font-mono text-rain-accent whitespace-nowrap"
                    >
                      <Sparkles className="w-3 h-3 inline mr-1" />Gen
                    </button>
                  }
                />
                {/* ISWC with format hint */}
                <Field
                  label="ISWC"
                  value={metadata.iswc ?? ''}
                  onValueChange={(v) => update({ iswc: v })}
                  placeholder="T-XXX.XXX.XXX-X"
                  hint="ISO 15707 — for the underlying composition (not the recording)."
                  error={metadata.iswc && !validateIswc(metadata.iswc) ? 'ISWC must match T-XXX.XXX.XXX-X with valid check digit.' : undefined}
                />
                {/* UPC with Generate button */}
                <Field
                  label="UPC"
                  value={metadata.upc}
                  onValueChange={(v) => update({ upc: v })}
                  placeholder="12-digit UPC"
                  hint="EAN-13 minus the leading zero. Generate or paste existing."
                  error={metadata.upc && !validateUpc(metadata.upc) ? 'UPC must be 12 digits with valid check digit.' : issueForField(issues, 'upc')}
                  warning={!metadata.upc ? 'Recommended — generate if you don\'t have one' : undefined}
                  suffix={
                    <button
                      type="button"
                      onClick={() => update({ upc: generateUpc() })}
                      className="px-2 py-1 rounded-md border border-rain-border bg-rain-surface-2 hover:border-rain-accent/50 text-[10px] font-mono text-rain-accent whitespace-nowrap"
                    >
                      <Sparkles className="w-3 h-3 inline mr-1" />Gen
                    </button>
                  }
                />
                <Field
                  label="Recording Year"
                  value={metadata.recordingYear ?? ''}
                  onValueChange={(v) => update({ recordingYear: v })}
                  placeholder={String(new Date().getFullYear())}
                  hint="May differ from release year for back-catalogue."
                  error={issueForField(issues, 'recordingYear')}
                />

                {/* Genre:Subgenre cascading selects */}
                <SelectField
                  label="Genre"
                  value={selectedGenre}
                  onValueChange={(g) => setGenreSubgenre(g, '')}
                  options={GENRE_SUBGENRE_OPTIONS.map((g) => ({ value: g.genre, label: g.genre }))}
                  placeholder="— Select genre —"
                  hint="Top-level DDEX genre."
                  containerClassName="lg:col-span-1"
                />
                <SelectField
                  label="Subgenre"
                  value={selectedSubgenre}
                  onValueChange={(s) => setGenreSubgenre(selectedGenre, s)}
                  options={
                    selectedGenre
                      ? (GENRE_SUBGENRE_OPTIONS.find((g) => g.genre === selectedGenre)?.subgenres.map((s) => ({ value: s, label: s })) ?? [])
                      : []
                  }
                  placeholder={selectedGenre ? '— Select subgenre —' : '— Pick a genre first —'}
                  hint="DDEX subgenre — written as Genre:Subgenre."
                  containerClassName="lg:col-span-1"
                />

                <SelectField
                  label="Language"
                  value={metadata.language ?? 'eng'}
                  onValueChange={(v) => update({ language: v })}
                  options={LANGUAGE_OPTIONS.map((l) => ({ value: l.value, label: `${l.value.toUpperCase()} — ${l.label}` }))}
                  hint="ISO 639-2 — primary lyrical language."
                />

                {/* Explicit + Parental Advisory */}
                <div className="flex flex-col gap-1">
                  <RadioField
                    label="Explicit Lyrics"
                    value={metadata.explicitLyrics ?? 'none'}
                    onValueChange={(v) => update({ explicitLyrics: v as TrackMetadata['explicitLyrics'] })}
                    layout="grid"
                    options={[
                      { value: 'none', label: 'None' },
                      { value: 'explicit', label: 'Explicit' },
                      { value: 'clean', label: 'Clean' },
                    ]}
                  />
                  <label className="flex items-center gap-2 mt-1 px-2 py-1 rounded-md border border-rain-border bg-rain-surface-2 cursor-pointer w-fit">
                    <Checkbox
                      checked={Boolean(metadata.parentalAdvisory)}
                      onCheckedChange={(c) => update({ parentalAdvisory: c === true })}
                    />
                    <span className="text-[11px] font-mono">Parental Advisory (PAL sticker)</span>
                  </label>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* ----------------------------------------------------------- */}
          {/* 3. Copyright & Publishing                                    */}
          {/* ----------------------------------------------------------- */}
          <AccordionItem value="copyright" className="border-rain-border">
            <AccordionTrigger className="text-sm font-mono uppercase tracking-wider text-rain-accent hover:no-underline">
              <span className="flex items-center gap-2">
                <span className="text-[9px] text-muted-foreground">03</span>
                Copyright &amp; Publishing
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid lg:grid-cols-2 gap-3 pb-2">
                <Field
                  label="P-Line Holder"
                  value={metadata.copyrightHolder ?? ''}
                  onValueChange={(v) => update({ copyrightHolder: v })}
                  placeholder="2024 Artist Name"
                  hint="Sound-recording copyright holder. Click Auto-suggest."
                  suffix={
                    <button
                      type="button"
                      onClick={suggestPline}
                      className="px-2 py-1 rounded-md border border-rain-border bg-rain-surface-2 hover:border-rain-accent/50 text-[10px] font-mono text-rain-accent whitespace-nowrap"
                    >
                      <Wand2 className="w-3 h-3 inline mr-1" />Auto
                    </button>
                  }
                />
                <Field
                  label="C-Line Year"
                  value={metadata.copyrightYear ?? ''}
                  onValueChange={(v) => update({ copyrightYear: v })}
                  placeholder={String(new Date().getFullYear())}
                  hint="Year for the C-line (composition copyright)."
                  error={issueForField(issues, 'copyrightYear')}
                />

                <Field
                  label="Publisher"
                  value={metadata.publisher ?? ''}
                  onValueChange={(v) => update({ publisher: v })}
                  placeholder="Music publisher name"
                />
                <Field
                  label="Publisher IPI"
                  value={metadata.publisherIpi ?? ''}
                  onValueChange={(v) => update({ publisherIpi: v })}
                  placeholder="9-11 digit CISAC IPI"
                  hint="Interested Parties Information (CISAC)."
                  error={issueForField(issues, 'publisherIpi')}
                />

                <SelectField
                  label="PRO / Collecting Society"
                  value={metadata.pro ?? ''}
                  onValueChange={(v) => update({ pro: v })}
                  options={PRO_OPTIONS.map((p) => ({ value: p.value, label: p.label }))}
                  hint="Performance Rights Organisation — PRS, ASCAP, BMI, SACEM, GEMA, etc."
                />

                <Field
                  label="Master Rights Owner"
                  value={metadata.masterOwner ?? ''}
                  onValueChange={(v) => update({ masterOwner: v })}
                  placeholder="Owner of the sound recording master"
                  hint="Distinct from P-line holder — often the label or artist."
                />

                <Field
                  label="Contract Reference"
                  value={metadata.contractReference ?? ''}
                  onValueChange={(v) => update({ contractReference: v })}
                  placeholder="Internal catalogue / contract ID"
                  hint="Optional — for your own bookkeeping."
                  containerClassName="lg:col-span-2"
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* ----------------------------------------------------------- */}
          {/* 4. Contributors / Credits                                    */}
          {/* ----------------------------------------------------------- */}
          <AccordionItem value="contributors" className="border-rain-border">
            <AccordionTrigger className="text-sm font-mono uppercase tracking-wider text-rain-accent hover:no-underline">
              <span className="flex items-center gap-2">
                <span className="text-[9px] text-muted-foreground">04</span>
                Contributors / Credits
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2 pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[10px] font-mono text-muted-foreground">
                    {(metadata.contributors ?? []).length} contributor{(metadata.contributors ?? []).length === 1 ? '' : 's'}
                    {writerShareTotal > 0 && (
                      <span
                        className={
                          Math.abs(writerShareTotal - 100) < 0.5
                            ? 'ml-2 text-rain-accent'
                            : 'ml-2 text-amber-400'
                        }
                      >
                        · Writer shares: {writerShareTotal.toFixed(1)}%
                        {Math.abs(writerShareTotal - 100) >= 0.5 && ' (should be 100%)'}
                      </span>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={addContributor}
                    className="bg-rain-surface-2 border-rain-border hover:border-rain-accent/50 hover:text-rain-accent font-mono text-[11px]"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Contributor
                  </Button>
                </div>

                {(metadata.contributors ?? []).length === 0 ? (
                  <div className="text-center py-6 text-[10px] font-mono text-muted-foreground/70 border border-dashed border-rain-border rounded-md">
                    No contributors yet. The primary artist is auto-added as Performer.
                  </div>
                ) : (
                  <div className="border border-rain-border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-rain-border hover:bg-transparent">
                          <TableHead className="text-[10px] font-mono uppercase text-muted-foreground">Name</TableHead>
                          <TableHead className="text-[10px] font-mono uppercase text-muted-foreground w-32">Role</TableHead>
                          <TableHead className="text-[10px] font-mono uppercase text-muted-foreground w-24">IPI</TableHead>
                          <TableHead className="text-[10px] font-mono uppercase text-muted-foreground w-24">ISNI</TableHead>
                          <TableHead className="text-[10px] font-mono uppercase text-muted-foreground w-20">Share %</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(metadata.contributors ?? []).map((c, i) => (
                          <TableRow key={i} className="border-rain-border">
                            <TableCell>
                              <input
                                type="text"
                                value={c.name}
                                onChange={(e) => updateContributor(i, { name: e.target.value })}
                                placeholder="Contributor name"
                                className="w-full bg-transparent px-1 py-1 text-xs font-mono focus:outline-none focus:bg-rain-surface-2/60 rounded"
                              />
                            </TableCell>
                            <TableCell>
                              <Select
                                value={c.role}
                                onValueChange={(v) => updateContributor(i, { role: v as ContributorRole })}
                              >
                                <SelectTrigger className="bg-rain-surface-2 border-rain-border h-7 text-[10px] font-mono px-1 w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-rain-surface-2 border-rain-border">
                                  {CONTRIBUTOR_ROLE_OPTIONS.map((r) => (
                                    <SelectItem key={r.value} value={r.value} className="text-[10px] font-mono focus:bg-rain-accent/15 focus:text-rain-accent">
                                      {r.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <input
                                type="text"
                                value={c.ipi ?? ''}
                                onChange={(e) => updateContributor(i, { ipi: e.target.value })}
                                placeholder="———"
                                className="w-full bg-transparent px-1 py-1 text-[10px] font-mono focus:outline-none focus:bg-rain-surface-2/60 rounded"
                              />
                            </TableCell>
                            <TableCell>
                              <input
                                type="text"
                                value={c.isni ?? ''}
                                onChange={(e) => updateContributor(i, { isni: e.target.value })}
                                placeholder="———"
                                className="w-full bg-transparent px-1 py-1 text-[10px] font-mono focus:outline-none focus:bg-rain-surface-2/60 rounded"
                              />
                            </TableCell>
                            <TableCell>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step="0.1"
                                value={c.share ?? ''}
                                onChange={(e) => updateContributor(i, { share: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                                placeholder="—"
                                disabled={!WRITER_ROLES.includes(c.role)}
                                className="w-full bg-transparent px-1 py-1 text-[10px] font-mono focus:outline-none focus:bg-rain-surface-2/60 rounded disabled:opacity-40"
                              />
                            </TableCell>
                            <TableCell>
                              <button
                                type="button"
                                onClick={() => removeContributor(i)}
                                className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors"
                                aria-label={`Remove contributor ${i + 1}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <div className="text-[9px] font-mono text-muted-foreground/70">
                  Share % applies only to songwriter / composer / lyricist / publisher roles — should sum to 100 across the release.
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* ----------------------------------------------------------- */}
          {/* 5. AI Disclosure                                             */}
          {/* ----------------------------------------------------------- */}
          <AccordionItem value="ai" className="border-rain-border">
            <AccordionTrigger className="text-sm font-mono uppercase tracking-wider text-rain-accent hover:no-underline">
              <span className="flex items-center gap-2">
                <span className="text-[9px] text-muted-foreground">05</span>
                AI Disclosure
                <Badge variant="outline" className="border-rain-accent/30 text-rain-accent text-[9px]">
                  EU AI Act §50
                </Badge>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pb-2">
                {disclosureHasGenerated && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-400/10 border border-amber-400/30">
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="text-[10px] font-mono text-amber-400/90">
                      Spotify requires AI-generated content disclosure. This will be flagged in the DDEX
                      <span className="text-rain-accent"> &lt;AIInvolvement&gt;</span> block of the ern.xml manifest.
                    </div>
                  </div>
                )}

                <div className="grid gap-3">
                  {DISCLOSURE_FIELDS.map((f) => (
                    <RadioField
                      key={f.key}
                      label={f.label}
                      value={(metadata.aiDisclosure as AiDisclosure)?.[f.key] ?? 'none'}
                      onValueChange={(v) => updateDisclosure(f.key, v as 'none' | 'assisted' | 'generated')}
                      layout="grid"
                      options={[
                        { value: 'none', label: 'None', tooltip: 'No AI used at this stage.' },
                        { value: 'assisted', label: 'Assisted', tooltip: 'AI tools used as one input among human decisions.' },
                        { value: 'generated', label: 'Generated', tooltip: f.tooltip },
                      ]}
                    />
                  ))}
                </div>

                <div className="text-[9px] font-mono text-muted-foreground/70">
                  Per-stage disclosure. RAIN V6 mastering is AI-assisted by default — set the Mastering
                  stage to <span className="text-rain-accent">assisted</span> to honestly reflect this.
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* ----------------------------------------------------------- */}
          {/* 6. Release Notes / Comments                                  */}
          {/* ----------------------------------------------------------- */}
          <AccordionItem value="notes" className="border-rain-border">
            <AccordionTrigger className="text-sm font-mono uppercase tracking-wider text-rain-accent hover:no-underline">
              <span className="flex items-center gap-2">
                <span className="text-[9px] text-muted-foreground">06</span>
                Release Notes
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="pb-2">
                <TextAreaField
                  label="Comments / Release Notes"
                  value={metadata.comment}
                  onValueChange={(v) => update({ comment: v })}
                  placeholder="Liner notes, credits narrative, anything you want embedded as RIFF INFO ICMT (WAV) / ID3v2 COMM (MP3) when the Metadata toggle is on at export."
                  hint="Embedded as the RIFF INFO ICMT chunk (WAV) or ID3v2 COMM frame (MP3) on export."
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </motion.div>

      {/* ----------------------------------------------------------------- */}
      {/* Reset confirmation                                                */}
      {/* ----------------------------------------------------------------- */}
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent className="bg-rain-surface-2 border-rain-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-rain-accent font-mono">Reset all metadata?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground font-mono text-xs">
              This restores every field to its default (single, worldwide, English, no AI disclosure,
              no parental advisory, RAIN V6 distributor). The rendered audio and provenance cert are
              not affected. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-rain-surface border-rain-border font-mono text-xs">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReset}
              className="bg-red-500 text-white hover:bg-red-500/90 font-mono text-xs"
            >
              Reset to defaults
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
