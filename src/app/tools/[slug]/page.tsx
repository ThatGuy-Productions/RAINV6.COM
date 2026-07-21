'use client'

import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Upload, Download, Loader2, CheckCircle2, AlertCircle, FileAudio, FileImage, FileText, Settings } from 'lucide-react'
import { getTool } from '@/lib/rain/tools-catalog'
import {
  decodeAudioFile, encodeWav, encodeAiff, encodeMp3,
  applyVolumeChange, applyBassBoost, applyEQ, applyReverse, applyPan,
  applyVocalRemover, applyReverb, applyPitchTempo, applyNoiseReduction,
  applyDownmix, trimAudio, detectBPM, generateWaveformImage, generateSpectrogramImage,
  convertSpotifyUri,
} from '@/lib/rain/tools-audio'
import { PDFDocument, degrees } from 'pdf-lib'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default function ToolPage({ params }: PageProps) {
  const [slug, setSlug] = useState<string>('')
  const [file, setFile] = useState<File | null>(null)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<{ url: string; filename: string; size: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<Record<string, number>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Unwrap params promise
  useState(() => {
    params.then((p) => setSlug(p.slug))
  })

  const tool = getTool(slug)

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      setFile(f)
      setResult(null)
      setError(null)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) {
      setFile(f)
      setResult(null)
      setError(null)
    }
  }, [])

  const process = useCallback(async () => {
    if (!file || !tool) return
    setProcessing(true)
    setError(null)
    setResult(null)
    try {
      let blob: Blob
      let filename: string
      const baseName = file.name.replace(/\.[^/.]+$/, '')

      switch (tool.converter) {
        // ── Audio conversions ──
        case 'audio-to-wav': {
          const buf = await decodeAudioFile(file)
          blob = encodeWav(buf, 16)
          break
        }
        case 'audio-to-mp3': {
          const buf = await decodeAudioFile(file)
          blob = encodeMp3(buf, 320)
          break
        }
        case 'audio-to-aiff': {
          const buf = await decodeAudioFile(file)
          blob = encodeAiff(buf)
          break
        }

        // ── Audio effects ──
        case 'effect-volume': {
          const buf = await decodeAudioFile(file)
          const processed = await applyVolumeChange(buf, options.gain ?? 6)
          blob = encodeWav(processed, 16)
          break
        }
        case 'effect-bass-boost': {
          const buf = await decodeAudioFile(file)
          const processed = await applyBassBoost(buf, options.boost ?? 8)
          blob = encodeWav(processed, 16)
          break
        }
        case 'effect-eq': {
          const buf = await decodeAudioFile(file)
          const bands = [
            { freq: 100, gain: options.low ?? 0 },
            { freq: 1000, gain: options.mid ?? 0 },
            { freq: 8000, gain: options.high ?? 0 },
          ]
          const processed = await applyEQ(buf, bands)
          blob = encodeWav(processed, 16)
          break
        }
        case 'effect-reverse': {
          const buf = await decodeAudioFile(file)
          const processed = applyReverse(buf)
          blob = encodeWav(processed, 16)
          break
        }
        case 'effect-pan': {
          const buf = await decodeAudioFile(file)
          const processed = await applyPan(buf, options.pan ?? 0)
          blob = encodeWav(processed, 16)
          break
        }
        case 'effect-vocal-remove': {
          const buf = await decodeAudioFile(file)
          const processed = applyVocalRemover(buf)
          blob = encodeWav(processed, 16)
          break
        }
        case 'effect-reverb': {
          const buf = await decodeAudioFile(file)
          const processed = await applyReverb(buf, options.decay ?? 2)
          blob = encodeWav(processed, 16)
          break
        }
        case 'effect-pitch-tempo': {
          const buf = await decodeAudioFile(file)
          const processed = await applyPitchTempo(buf, options.pitch ?? 0, options.tempo ?? 1)
          blob = encodeWav(processed, 16)
          break
        }
        case 'effect-noise-reduce': {
          const buf = await decodeAudioFile(file)
          const processed = await applyNoiseReduction(buf, options.threshold ?? 0.5)
          blob = encodeWav(processed, 16)
          break
        }
        case 'effect-downmix': {
          const buf = await decodeAudioFile(file)
          const processed = applyDownmix(buf, (options.channels ?? 1) as 1 | 2)
          blob = encodeWav(processed, 16)
          break
        }
        case 'effect-3d': {
          // Use HRTF via PannerNode
          const buf = await decodeAudioFile(file)
          const ctx = new OfflineAudioContext(2, buf.length, buf.sampleRate)
          const src = ctx.createBufferSource()
          src.buffer = buf
          const panner = ctx.createPanner()
          panner.panningModel = 'HRTF'
          panner.positionX.value = options.x ?? 0
          panner.positionY.value = 0
          panner.positionZ.value = -1
          src.connect(panner).connect(ctx.destination)
          src.start(0)
          const processed = await ctx.startRendering()
          blob = encodeWav(processed, 16)
          break
        }
        case 'effect-auto-pan': {
          const buf = await decodeAudioFile(file)
          const ctx = new OfflineAudioContext(2, buf.length, buf.sampleRate)
          const src = ctx.createBufferSource()
          src.buffer = buf
          const panner = ctx.createStereoPanner()
          const lfo = ctx.createOscillator()
          lfo.frequency.value = options.rate ?? 2
          const lfoGain = ctx.createGain()
          lfoGain.gain.value = 1
          lfo.connect(lfoGain).connect(panner.pan)
          src.connect(panner).connect(ctx.destination)
          src.start(0)
          lfo.start(0)
          const processed = await ctx.startRendering()
          blob = encodeWav(processed, 16)
          break
        }

        // ── Audio tools ──
        case 'tool-trim': {
          const buf = await decodeAudioFile(file)
          const duration = buf.duration
          const start = (options.start ?? 0) / 100 * duration
          const end = (options.end ?? 100) / 100 * duration
          const processed = trimAudio(buf, start, end)
          blob = encodeWav(processed, 16)
          break
        }
        case 'tool-bpm': {
          const buf = await decodeAudioFile(file)
          const bpm = detectBPM(buf)
          blob = new Blob([`Detected BPM: ${bpm}\n\nFile: ${file.name}\nDuration: ${buf.duration.toFixed(1)}s\nSample rate: ${buf.sampleRate} Hz`], { type: 'text/plain' })
          break
        }
        case 'tool-waveform-img': {
          const buf = await decodeAudioFile(file)
          blob = generateWaveformImage(buf) as unknown as Blob
          break
        }
        case 'tool-spectrogram-img': {
          const buf = await decodeAudioFile(file)
          blob = generateSpectrogramImage(buf) as unknown as Blob
          break
        }
        case 'tool-spotify-uri': {
          const text = await file.text()
          const converted = convertSpotifyUri(text.trim())
          blob = new Blob([converted], { type: 'text/plain' })
          break
        }

        // ── Image conversion ──
        case 'image-convert': {
          const img = await loadImage(file)
          const canvas = document.createElement('canvas')
          canvas.width = img.width
          canvas.height = img.height
          const ctx2d = canvas.getContext('2d')!
          // White background for JPG (no transparency)
          if (tool.outputExt === 'jpg' || tool.outputExt === 'jpeg') {
            ctx2d.fillStyle = '#fff'
            ctx2d.fillRect(0, 0, canvas.width, canvas.height)
          }
          ctx2d.drawImage(img, 0, 0)
          blob = await new Promise<Blob>((resolve) =>
            canvas.toBlob((b) => resolve(b!), tool.outputMime, 0.92)
          )
          break
        }

        // ── PDF tools ──
        case 'pdf-rotate': {
          const bytes = await file.arrayBuffer()
          const pdf = await PDFDocument.load(bytes)
          const pages = pdf.getPages()
          const angle = (options.angle ?? 90) as number
          pages.forEach((page) => {
            const current = page.getRotation().angle || 0
            page.setRotation(degrees((current + angle) % 360))
          })
          const out = await pdf.save()
          blob = new Blob([out], { type: 'application/pdf' })
          break
        }
        case 'pdf-split': {
          const bytes = await file.arrayBuffer()
          const pdf = await PDFDocument.load(bytes)
          const pages = pdf.getPages()
          // Create a single PDF with just the first page for download (full split would be a ZIP)
          const newPdf = await PDFDocument.create()
          const [copiedPage] = await newPdf.copyPages(pdf, [0])
          newPdf.addPage(copiedPage)
          const out = await newPdf.save()
          blob = new Blob([out], { type: 'application/pdf' })
          break
        }
        case 'pdf-combine': {
          // Multiple files needed — use the first file for now
          const bytes = await file.arrayBuffer()
          const pdf = await PDFDocument.load(bytes)
          const out = await pdf.save()
          blob = new Blob([out], { type: 'application/pdf' })
          break
        }
        case 'pdf-extract': {
          const bytes = await file.arrayBuffer()
          const pdf = await PDFDocument.load(bytes)
          const pages = pdf.getPages()
          const startPage = Math.max(0, (options.startPage ?? 1) - 1)
          const endPage = Math.min(pages.length, options.endPage ?? pages.length)
          const newPdf = await PDFDocument.create()
          const indices = []
          for (let i = startPage; i < endPage; i++) indices.push(i)
          const copied = await newPdf.copyPages(pdf, indices)
          copied.forEach((p) => newPdf.addPage(p))
          const out = await newPdf.save()
          blob = new Blob([out], { type: 'application/pdf' })
          break
        }
        case 'pdf-from-html': {
          const html = await file.text()
          // Create a simple PDF from HTML text content
          const pdf = await PDFDocument.create()
          const page = pdf.addPage([612, 792])
          const font = await pdf.embedFont('Helvetica')
          const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000)
          page.drawText(text.slice(0, 80) || ' ', {
            x: 50, y: 750, size: 12, font, maxWidth: 512,
          })
          // Simple line-by-line layout
          const lines = text.match(/.{1,80}(\s|$)/g) || []
          lines.slice(0, 50).forEach((line, i) => {
            page.drawText(line.trim(), {
              x: 50, y: 730 - i * 14, size: 10, font, maxWidth: 512,
            })
          })
          const out = await pdf.save()
          blob = new Blob([out], { type: 'application/pdf' })
          break
        }

        default:
          throw new Error(`Unknown converter: ${tool.converter}`)
      }

      filename = `${baseName}.${tool.outputExt}`
      const url = URL.createObjectURL(blob)
      setResult({ url, filename, size: blob.size })
    } catch (e) {
      console.error('[tool] failed:', e)
      setError(e instanceof Error ? e.message : 'Processing failed')
    } finally {
      setProcessing(false)
    }
  })

  if (!tool) {
    return (
      <div className="min-h-screen bg-[#0a0c10] text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-4">Tool not found</p>
          <Link href="/tools" className="text-[#AAFF00] hover:underline">← Back to tools</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0c10] text-white">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-[rgba(10,12,16,0.8)] border-b border-[rgba(170,255,0,0.1)]">
        <div className="max-w-3xl mx-auto h-14 px-4 flex items-center justify-between">
          <Link href="/tools" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
            All tools
          </Link>
          <span className="text-[10px] font-mono text-muted-foreground/60">in-browser · no upload</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12">
        {/* Tool header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">{tool.name}</h1>
          <p className="text-sm text-muted-foreground">{tool.description}</p>
        </div>

        {/* Upload zone */}
        {!result && !processing && (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-white/[0.1] rounded-xl p-12 text-center cursor-pointer hover:border-[rgba(170,255,0,0.3)] hover:bg-white/[0.02] transition-all"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={tool.accept}
              onChange={handleFileSelect}
              className="hidden"
            />
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <FileAudio className="w-8 h-8 text-[#AAFF00]" />
                <span className="text-sm font-medium">{file.name}</span>
                <span className="text-[11px] text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                <span className="text-[10px] text-muted-foreground/50">Click to change</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-8 h-8 text-muted-foreground/40" />
                <span className="text-sm text-muted-foreground">Drop file here or click to browse</span>
                <span className="text-[10px] text-muted-foreground/50">Accepts: {tool.accept}</span>
              </div>
            )}
          </div>
        )}

        {/* Options */}
        {file && !result && !processing && (
          <div className="mt-6">
            <ToolOptions tool={tool} options={options} setOptions={setOptions} />
          </div>
        )}

        {/* Process button */}
        {file && !result && (
          <button
            onClick={process}
            disabled={processing}
            className="w-full mt-6 h-12 rounded-lg bg-[#AAFF00] text-black font-semibold text-sm hover:bg-[#c5ff4a] active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {processing ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Processing…</>
            ) : (
              <>Convert to .{tool.outputExt}</>
            )}
          </button>
        )}

        {/* Processing state */}
        {processing && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-[#AAFF00] mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Processing your file…</p>
            <p className="text-[10px] text-muted-foreground/50 mt-1">This happens in your browser — no upload</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-500/25 bg-red-500/5 p-4 mt-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-300">Processing failed</p>
                <p className="text-[11px] text-red-300/70 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="rounded-xl border border-[rgba(170,255,0,0.2)] bg-[rgba(170,255,0,0.04)] p-6 text-center">
            <CheckCircle2 className="w-10 h-10 text-[#AAFF00] mx-auto mb-3" />
            <h3 className="text-sm font-semibold mb-1">Conversion complete!</h3>
            <p className="text-[11px] text-muted-foreground mb-4">
              {result.filename} · {(result.size / 1024).toFixed(0)} KB
            </p>
            <a
              href={result.url}
              download={result.filename}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-[#AAFF00] text-black font-semibold text-sm hover:bg-[#c5ff4a] active:scale-95 transition-all"
            >
              <Download className="w-4 h-4" />
              Download
            </a>
            <button
              onClick={() => { setFile(null); setResult(null) }}
              className="block mx-auto mt-3 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Convert another file
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

// ── Option slider (module-level component, not created during render) ──
function OptionSlider({ label, keyName, min, max, step, def, unit, options, setFn }: {
  label: string; keyName: string; min: number; max: number; step: number; def: number; unit?: string
  options: Record<string, number>
  setFn: (key: string, val: number) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-mono text-muted-foreground">{label}</span>
        <span className="text-[11px] font-mono text-[#AAFF00]">{(options[keyName] ?? def)}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={options[keyName] ?? def}
        onChange={(e) => setFn(keyName, parseFloat(e.target.value))}
        className="w-full accent-[#AAFF00]"
      />
    </div>
  )
}

// ── Tool-specific options UI ──────────────────────────────────────────────

function ToolOptions({ tool, options, setOptions }: {
  tool: ReturnType<typeof getTool>
  options: Record<string, number>
  setOptions: (o: Record<string, number>) => void
}) {
  if (!tool) return null
  const set = (key: string, val: number) => setOptions({ ...options, [key]: val })

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-4">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-2">
        <Settings className="w-3 h-3" />
        Options
      </div>
      {tool.converter === 'effect-volume' && <OptionSlider label="Volume" keyName="gain" min={-24} max={24} step={1} def={6} unit=" dB" options={options} setFn={set} />}
      {tool.converter === 'effect-bass-boost' && <OptionSlider label="Bass boost" keyName="boost" min={0} max={20} step={1} def={8} unit=" dB" options={options} setFn={set} />}
      {tool.converter === 'effect-eq' && (
        <>
          <OptionSlider label="Low (100 Hz)" keyName="low" min={-12} max={12} step={1} def={0} unit=" dB" options={options} setFn={set} />
          <OptionSlider label="Mid (1 kHz)" keyName="mid" min={-12} max={12} step={1} def={0} unit=" dB" options={options} setFn={set} />
          <OptionSlider label="High (8 kHz)" keyName="high" min={-12} max={12} step={1} def={0} unit=" dB" options={options} setFn={set} />
        </>
      )}
      {tool.converter === 'effect-pan' && <OptionSlider label="Pan" keyName="pan" min={-1} max={1} step={0.1} def={0} options={options} setFn={set} />}
      {tool.converter === 'effect-reverb' && <OptionSlider label="Decay" keyName="decay" min={0.5} max={5} step={0.1} def={2} unit="s" options={options} setFn={set} />}
      {tool.converter === 'effect-pitch-tempo' && (
        <>
          <OptionSlider label="Pitch" keyName="pitch" min={-12} max={12} step={1} def={0} unit=" st" options={options} setFn={set} />
          <OptionSlider label="Tempo" keyName="tempo" min={0.5} max={2} step={0.05} def={1} unit="x" options={options} setFn={set} />
        </>
      )}
      {tool.converter === 'effect-noise-reduce' && <OptionSlider label="Strength" keyName="threshold" min={0} max={1} step={0.1} def={0.5} options={options} setFn={set} />}
      {tool.converter === 'effect-downmix' && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-mono text-muted-foreground">Channels</span>
            <span className="text-[11px] font-mono text-[#AAFF00]">{(options.channels ?? 1) === 1 ? 'Mono' : 'Stereo'}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => set('channels', 1)} className={`flex-1 py-1.5 rounded text-[11px] font-mono ${(options.channels ?? 1) === 1 ? 'bg-[#AAFF00] text-black' : 'bg-white/[0.04] text-muted-foreground'}`}>Mono</button>
            <button onClick={() => set('channels', 2)} className={`flex-1 py-1.5 rounded text-[11px] font-mono ${options.channels === 2 ? 'bg-[#AAFF00] text-black' : 'bg-white/[0.04] text-muted-foreground'}`}>Stereo</button>
          </div>
        </div>
      )}
      {tool.converter === 'effect-3d' && <OptionSlider label="X position" keyName="x" min={-1} max={1} step={0.1} def={0} options={options} setFn={set} />}
      {tool.converter === 'effect-auto-pan' && <OptionSlider label="Rate" keyName="rate" min={0.5} max={10} step={0.5} def={2} unit=" Hz" options={options} setFn={set} />}
      {tool.converter === 'tool-trim' && (
        <>
          <OptionSlider label="Start" keyName="start" min={0} max={100} step={1} def={0} unit="%" options={options} setFn={set} />
          <OptionSlider label="End" keyName="end" min={0} max={100} step={1} def={100} unit="%" options={options} setFn={set} />
        </>
      )}
      {tool.converter === 'pdf-rotate' && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-mono text-muted-foreground">Angle</span>
            <span className="text-[11px] font-mono text-[#AAFF00]">{options.angle ?? 90}°</span>
          </div>
          <div className="flex gap-2">
            {[90, 180, 270].map((a) => (
              <button key={a} onClick={() => set('angle', a)} className={`flex-1 py-1.5 rounded text-[11px] font-mono ${(options.angle ?? 90) === a ? 'bg-[#AAFF00] text-black' : 'bg-white/[0.04] text-muted-foreground'}`}>{a}°</button>
            ))}
          </div>
        </div>
      )}
      {tool.converter === 'pdf-extract' && (
        <>
          <OptionSlider label="Start page" keyName="startPage" min={1} max={50} step={1} def={1} options={options} setFn={set} />
          <OptionSlider label="End page" keyName="endPage" min={1} max={50} step={1} def={1} options={options} setFn={set} />
        </>
      )}
      {/* No options for simple conversions */}
      {['audio-to-wav', 'audio-to-mp3', 'audio-to-aiff', 'effect-reverse', 'effect-vocal-remove', 'tool-bpm', 'tool-waveform-img', 'tool-spectrogram-img', 'tool-spotify-uri', 'image-convert', 'pdf-split', 'pdf-combine', 'pdf-from-html'].includes(tool.converter) && (
        <p className="text-[11px] text-muted-foreground/50 italic">No options needed — just upload and convert.</p>
      )}
    </div>
  )
}

// ── Helper: load image ────────────────────────────────────────────────────

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { resolve(img) }
    img.onerror = reject
    img.src = url
  })
}
