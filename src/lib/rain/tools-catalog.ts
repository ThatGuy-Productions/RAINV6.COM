/**
 * RAIN V6 — Free Tools catalog
 *
 * Defines all available free tools, their categories, and which
 * converters/processors they use. Each tool has a slug that maps to
 * a route at /tools/[slug].
 *
 * Only tools that ACTUALLY WORK in-browser are listed here. No fake
 * "Go to Page" buttons — every tool page has a real file converter.
 */

export type ToolCategory =
  | 'audio-convert'
  | 'audio-effects'
  | 'audio-tools'
  | 'image-convert'
  | 'pdf-tools'

export interface ToolDef {
  slug: string
  name: string
  description: string
  category: ToolCategory
  /** Input file extensions accepted */
  accept: string
  /** Output file extension */
  outputExt: string
  /** Output MIME type */
  outputMime: string
  /** Converter function key — maps to the actual processing function */
  converter: string
}

export const CATEGORY_LABELS: Record<ToolCategory, { label: string; icon: string }> = {
  'audio-convert': { label: 'Audio Conversion', icon: 'Music' },
  'audio-effects': { label: 'Audio Effects', icon: 'Sliders' },
  'audio-tools': { label: 'Audio Tools', icon: 'Wrench' },
  'image-convert': { label: 'Image Conversion', icon: 'Image' },
  'pdf-tools': { label: 'PDF Tools', icon: 'FileText' },
}

export const TOOLS: ToolDef[] = [
  // ── Audio Conversion ──────────────────────────────────────────────
  { slug: 'flac-to-wav', name: 'FLAC to WAV', description: 'Convert FLAC audio to WAV', category: 'audio-convert', accept: '.flac,.m4a,.ogg,.mp3,.wav,.aiff', outputExt: 'wav', outputMime: 'audio/wav', converter: 'audio-to-wav' },
  { slug: 'flac-to-mp3', name: 'FLAC to MP3', description: 'Convert FLAC audio to MP3', category: 'audio-convert', accept: '.flac,.m4a,.ogg,.wav,.aiff,.mp3', outputExt: 'mp3', outputMime: 'audio/mpeg', converter: 'audio-to-mp3' },
  { slug: 'wav-to-mp3', name: 'WAV to MP3', description: 'Convert WAV to MP3', category: 'audio-convert', accept: '.wav,.flac,.aiff,.m4a,.ogg', outputExt: 'mp3', outputMime: 'audio/mpeg', converter: 'audio-to-mp3' },
  { slug: 'wav-to-aiff', name: 'WAV to AIFF', description: 'Convert WAV to AIFF', category: 'audio-convert', accept: '.wav,.flac,.mp3,.m4a,.ogg', outputExt: 'aiff', outputMime: 'audio/aiff', converter: 'audio-to-aiff' },
  { slug: 'aiff-to-wav', name: 'AIFF to WAV', description: 'Convert AIFF to WAV', category: 'audio-convert', accept: '.aiff,.aif,.wav,.flac,.mp3,.m4a,.ogg', outputExt: 'wav', outputMime: 'audio/wav', converter: 'audio-to-wav' },
  { slug: 'aiff-to-mp3', name: 'AIFF to MP3', description: 'Convert AIFF to MP3', category: 'audio-convert', accept: '.aiff,.aif,.wav,.flac,.m4a,.ogg', outputExt: 'mp3', outputMime: 'audio/mpeg', converter: 'audio-to-mp3' },
  { slug: 'mp3-to-wav', name: 'MP3 to WAV', description: 'Convert MP3 to WAV', category: 'audio-convert', accept: '.mp3,.flac,.m4a,.ogg,.aiff', outputExt: 'wav', outputMime: 'audio/wav', converter: 'audio-to-wav' },

  // ── Audio Effects ─────────────────────────────────────────────────
  { slug: 'volume-changer', name: 'Volume Changer', description: 'Adjust audio volume', category: 'audio-effects', accept: '.wav,.mp3,.flac,.m4a,.ogg,.aiff', outputExt: 'wav', outputMime: 'audio/wav', converter: 'effect-volume' },
  { slug: 'bass-booster', name: 'Bass Booster', description: 'Boost bass frequencies', category: 'audio-effects', accept: '.wav,.mp3,.flac,.m4a,.ogg,.aiff', outputExt: 'wav', outputMime: 'audio/wav', converter: 'effect-bass-boost' },
  { slug: 'equalizer', name: 'Equalizer', description: 'Adjust EQ bands', category: 'audio-effects', accept: '.wav,.mp3,.flac,.m4a,.ogg,.aiff', outputExt: 'wav', outputMime: 'audio/wav', converter: 'effect-eq' },
  { slug: 'reverse-audio', name: 'Reverse Audio', description: 'Reverse audio playback', category: 'audio-effects', accept: '.wav,.mp3,.flac,.m4a,.ogg,.aiff', outputExt: 'wav', outputMime: 'audio/wav', converter: 'effect-reverse' },
  { slug: 'stereo-panner', name: 'Stereo Panner', description: 'Pan audio left/right', category: 'audio-effects', accept: '.wav,.mp3,.flac,.m4a,.ogg,.aiff', outputExt: 'wav', outputMime: 'audio/wav', converter: 'effect-pan' },
  { slug: 'vocal-remover', name: 'Vocal Remover', description: 'Remove center-panned vocals', category: 'audio-effects', accept: '.wav,.mp3,.flac,.m4a,.ogg,.aiff', outputExt: 'wav', outputMime: 'audio/wav', converter: 'effect-vocal-remove' },
  { slug: 'reverb', name: 'Reverb', description: 'Add reverb effect', category: 'audio-effects', accept: '.wav,.mp3,.flac,.m4a,.ogg,.aiff', outputExt: 'wav', outputMime: 'audio/wav', converter: 'effect-reverb' },
  { slug: 'pitch-tempo', name: 'Pitch & Tempo Changer', description: 'Change pitch and tempo', category: 'audio-effects', accept: '.wav,.mp3,.flac,.m4a,.ogg,.aiff', outputExt: 'wav', outputMime: 'audio/wav', converter: 'effect-pitch-tempo' },
  { slug: 'noise-reducer', name: 'Noise Reducer', description: 'Reduce background noise', category: 'audio-effects', accept: '.wav,.mp3,.flac,.m4a,.ogg,.aiff', outputExt: 'wav', outputMime: 'audio/wav', converter: 'effect-noise-reduce' },
  { slug: 'downmixer', name: 'Downmixer', description: 'Convert to mono or stereo', category: 'audio-effects', accept: '.wav,.mp3,.flac,.m4a,.ogg,.aiff', outputExt: 'wav', outputMime: 'audio/wav', converter: 'effect-downmix' },
  { slug: '3d-audio', name: '3D Audio', description: 'Apply HRTF 3D spatial effect', category: 'audio-effects', accept: '.wav,.mp3,.flac,.m4a,.ogg,.aiff', outputExt: 'wav', outputMime: 'audio/wav', converter: 'effect-3d' },
  { slug: 'auto-panner', name: 'Auto Panner', description: 'Automatic L/R panning', category: 'audio-effects', accept: '.wav,.mp3,.flac,.m4a,.ogg,.aiff', outputExt: 'wav', outputMime: 'audio/wav', converter: 'effect-auto-pan' },

  // ── Audio Tools ────────────────────────────────────────────────────
  { slug: 'audio-trimmer', name: 'Audio Trimmer', description: 'Cut/trim audio to a time range', category: 'audio-tools', accept: '.wav,.mp3,.flac,.m4a,.ogg,.aiff', outputExt: 'wav', outputMime: 'audio/wav', converter: 'tool-trim' },
  { slug: 'bpm-detector', name: 'BPM Detector', description: 'Detect tempo (BPM) of audio', category: 'audio-tools', accept: '.wav,.mp3,.flac,.m4a,.ogg,.aiff', outputExt: 'txt', outputMime: 'text/plain', converter: 'tool-bpm' },
  { slug: 'waveform-image', name: 'Waveform Image', description: 'Generate waveform PNG', category: 'audio-tools', accept: '.wav,.mp3,.flac,.m4a,.ogg,.aiff', outputExt: 'png', outputMime: 'image/png', converter: 'tool-waveform-img' },
  { slug: 'spectrogram-image', name: 'Spectrogram Image', description: 'Generate spectrogram PNG', category: 'audio-tools', accept: '.wav,.mp3,.flac,.m4a,.ogg,.aiff', outputExt: 'png', outputMime: 'image/png', converter: 'tool-spectrogram-img' },
  { slug: 'spotify-uri', name: 'Spotify URL ↔ URI', description: 'Convert between Spotify URLs and URIs', category: 'audio-tools', accept: '.txt', outputExt: 'txt', outputMime: 'text/plain', converter: 'tool-spotify-uri' },

  // ── Image Conversion ──────────────────────────────────────────────
  { slug: 'jpg-to-png', name: 'JPG to PNG', description: 'Convert JPG to PNG', category: 'image-convert', accept: '.jpg,.jpeg', outputExt: 'png', outputMime: 'image/png', converter: 'image-convert' },
  { slug: 'png-to-jpg', name: 'PNG to JPG', description: 'Convert PNG to JPG', category: 'image-convert', accept: '.png', outputExt: 'jpg', outputMime: 'image/jpeg', converter: 'image-convert' },
  { slug: 'webp-to-png', name: 'WEBP to PNG', description: 'Convert WEBP to PNG', category: 'image-convert', accept: '.webp', outputExt: 'png', outputMime: 'image/png', converter: 'image-convert' },
  { slug: 'png-to-webp', name: 'PNG to WEBP', description: 'Convert PNG to WEBP', category: 'image-convert', accept: '.png', outputExt: 'webp', outputMime: 'image/webp', converter: 'image-convert' },
  { slug: 'jpg-to-webp', name: 'JPG to WEBP', description: 'Convert JPG to WEBP', category: 'image-convert', accept: '.jpg,.jpeg', outputExt: 'webp', outputMime: 'image/webp', converter: 'image-convert' },
  { slug: 'png-to-gif', name: 'PNG to GIF', description: 'Convert PNG to GIF', category: 'image-convert', accept: '.png', outputExt: 'gif', outputMime: 'image/gif', converter: 'image-convert' },

  // ── PDF Tools ─────────────────────────────────────────────────────
  { slug: 'pdf-rotate', name: 'Rotate PDF', description: 'Rotate all pages in a PDF', category: 'pdf-tools', accept: '.pdf', outputExt: 'pdf', outputMime: 'application/pdf', converter: 'pdf-rotate' },
  { slug: 'pdf-split', name: 'Split PDF', description: 'Split PDF into individual pages', category: 'pdf-tools', accept: '.pdf', outputExt: 'pdf', outputMime: 'application/pdf', converter: 'pdf-split' },
  { slug: 'pdf-combine', name: 'Combine PDFs', description: 'Merge multiple PDFs into one', category: 'pdf-tools', accept: '.pdf', outputExt: 'pdf', outputMime: 'application/pdf', converter: 'pdf-combine' },
  { slug: 'pdf-extract', name: 'Extract PDF Pages', description: 'Extract specific pages from PDF', category: 'pdf-tools', accept: '.pdf', outputExt: 'pdf', outputMime: 'application/pdf', converter: 'pdf-extract' },
  { slug: 'html-to-pdf', name: 'HTML to PDF', description: 'Convert HTML content to PDF', category: 'pdf-tools', accept: '.html,.htm', outputExt: 'pdf', outputMime: 'application/pdf', converter: 'pdf-from-html' },
]

export function getTool(slug: string): ToolDef | undefined {
  return TOOLS.find((t) => t.slug === slug)
}

export function getToolsByCategory(cat: ToolCategory): ToolDef[] {
  return TOOLS.filter((t) => t.category === cat)
}
