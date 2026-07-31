'use client'

import { useCallback, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { FileAudio, Upload, X, Zap } from 'lucide-react'
import { audioEngine } from '@/lib/rain/audio-engine'
import { useSessionStore } from '@/lib/rain/store'
import { notifyInfo, notifyError } from '@/lib/rain/notifications'
import { loadDemoTrack } from '@/lib/rain/demo-loader'

/** Compute a tiny waveform preview (normalized 0–1) from audio channels. */
function computeWaveformThumbnail(channels: Float32Array[], barCount: number): number[] {
  if (!channels.length) return []
  const len = channels[0].length
  const mono = new Float32Array(len)
  for (const ch of channels) {
    for (let i = 0; i < len; i++) mono[i] += ch[i]
  }
  const numCh = channels.length
  for (let i = 0; i < len; i++) mono[i] /= numCh

  const samplesPerBar = Math.floor(len / barCount)
  if (samplesPerBar === 0) return Array.from({ length: barCount }, () => 0.5)

  const bars: number[] = []
  for (let b = 0; b < barCount; b++) {
    let sum = 0
    const start = b * samplesPerBar
    const end = Math.min(start + samplesPerBar, len)
    for (let i = start; i < end; i++) {
      sum += Math.abs(mono[i])
    }
    bars.push(sum / (end - start))
  }
  const max = Math.max(...bars, 0.0001)
  return bars.map((b) => b / max)
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function UploadZone() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [waveformThumb, setWaveformThumb] = useState<number[]>([])
  const setFileInfo = useSessionStore((s) => s.setFileInfo)
  const setInputAnalysis = useSessionStore((s) => s.setInputAnalysis)
  const setMetadata = useSessionStore((s) => s.setMetadata)
  const fileName = useSessionStore((s) => s.fileName)
  const fileDuration = useSessionStore((s) => s.fileDuration)
  const fileSampleRate = useSessionStore((s) => s.fileSampleRate)
  const fileBitDepth = useSessionStore((s) => s.fileBitDepth)
  const fileChannels = useSessionStore((s) => s.fileChannels)
  const resetProcessing = useSessionStore((s) => s.resetProcessing)
  const setIsDemo = useSessionStore((s) => s.setIsDemo)
  const isDemo = useSessionStore((s) => s.isDemo)
  const [demoLoading, setDemoLoading] = useState(false)

  const handleFile = useCallback(async (file: File) => {
    setError(null)
    setIsLoading(true)
    setWaveformThumb([])
    setIsDemo(false) // Reset demo flag when loading a real file
    try {
      if (!file.type.startsWith('audio/') && !/\.(wav|mp3|flac|aac|ogg|m4a|aiff)$/i.test(file.name)) {
        throw new Error('Please upload an audio file (WAV, MP3, FLAC, AAC, OGG, M4A, AIFF)')
      }
      const { analysis, duration, sampleRate, channels } = await audioEngine.loadFile(file)
      setFileInfo(file.name, duration, sampleRate, 24, channels)
      setInputAnalysis(analysis)
      // Auto-fill title from filename
      const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ')
      setMetadata({ title: baseName })
      resetProcessing()

      // Compute waveform thumbnail
      const audioChannels = audioEngine.getInputChannels()
      if (audioChannels && audioChannels.length > 0) {
        setWaveformThumb(computeWaveformThumbnail(audioChannels, 32))
      }

      notifyInfo('Audio loaded', `${duration.toFixed(1)}s · ${(sampleRate / 1000).toFixed(1)}kHz`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audio')
      notifyError('File load failed', e instanceof Error ? e.message : 'Failed to decode audio file')
    } finally {
      setIsLoading(false)
    }
  }, [setFileInfo, setInputAnalysis, setMetadata, resetProcessing, setIsDemo])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }, [handleFile])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleLoadDemo = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent triggering the file input click
    // AUDIT-M3 FIX: previously no try/finally — if loadDemoTrack() threw (network
    // error, 404 on /demo-sample.wav, decode failure) the setDemoLoading(false)
    // never ran and the button stayed permanently disabled with an unhandled
    // promise rejection. Now wrapped in try/finally so the spinner always clears.
    setDemoLoading(true)
    try {
      await loadDemoTrack()
      // Compute waveform thumbnail after demo loads
      const audioChannels = audioEngine.getInputChannels()
      if (audioChannels && audioChannels.length > 0) {
        setWaveformThumb(computeWaveformThumbnail(audioChannels, 32))
      }
    } catch (err) {
      console.error('[UploadZone] demo load failed:', err)
    } finally {
      setDemoLoading(false)
    }
  }, [])

  // File info pills for the loaded state
  const infoPills = fileName
    ? [
        ...(isDemo ? [{ label: 'Demo', color: 'bg-rain-accent/20 text-rain-accent border-rain-accent/40' }] : []),
        { label: formatDuration(fileDuration), color: 'bg-rain-accent/15 text-rain-accent border-rain-accent/30' },
        { label: `${(fileSampleRate / 1000).toFixed(1)}kHz`, color: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
        { label: fileChannels >= 2 ? 'Stereo' : 'Mono', color: 'bg-purple-500/10 text-purple-400 border-purple-500/30' },
        { label: `${fileBitDepth}bit`, color: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
      ]
    : []

  if (fileName) {
    return (
      <div className="rain-panel rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10 flex-shrink-0">
            {/* Waveform thumbnail behind the file icon */}
            <div className="absolute inset-0 flex items-center justify-center gap-px px-1">
              {waveformThumb.length === 32
                ? waveformThumb.map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-full"
                      style={{
                        height: `${15 + h * 70}%`,
                        background: 'rgba(170, 255, 0, 0.35)',
                      }}
                    />
                  ))
                : null}
            </div>
            <div className="absolute inset-0 rounded-md bg-rain-accent/10 border border-rain-accent/30 flex items-center justify-center z-10">
              <FileAudio className="w-5 h-5 text-rain-accent" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{fileName}</div>
            <div className="text-[10px] font-mono text-muted-foreground">
              Loaded · ready to master
            </div>
          </div>
          <button
            onClick={() => { inputRef.current?.click() }}
            className="text-xs px-2.5 py-1.5 rounded-md border border-rain-border hover:border-rain-accent/50 transition-colors"
            aria-label="Replace audio file"
          >
            Replace
          </button>
        </div>
        {/* File info pills */}
        {infoPills.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            {infoPills.map((pill, i) => (
              <span
                key={i}
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono border ${pill.color}`}
              >
                {pill.label}
              </span>
            ))}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.flac,.aac,.ogg,.m4a,.aiff"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
            e.target.value = ''
          }}
        />
      </div>
    )
  }

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={() => inputRef.current?.click()}
      className={`relative cursor-pointer rounded-lg border-2 border-dashed transition-all p-8 text-center ${
        isDragging
          ? 'border-rain-accent bg-rain-accent/5 rain-glow-pulse scale-[1.02]'
          : 'border-rain-border hover:border-rain-accent/50 bg-rain-surface-2/40'
      }`}
      role="button"
      tabIndex={0}
      aria-label="Upload audio file"
      onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.click() }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.wav,.mp3,.flac,.aac,.ogg,.m4a,.aiff"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
          e.target.value = ''
        }}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center gap-3"
      >
        {isLoading ? (
          /* Animated progress ring */
          <div className="relative w-10 h-10" style={{ animation: 'spin 1.5s linear infinite' }}>
            <svg className="w-10 h-10" viewBox="0 0 40 40">
              <circle
                cx="20"
                cy="20"
                r="16"
                fill="none"
                stroke="var(--rain-accent)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="60 100"
                opacity="0.3"
              />
              <circle
                cx="20"
                cy="20"
                r="16"
                fill="none"
                stroke="var(--rain-accent)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="30 100"
              />
            </svg>
          </div>
        ) : (
          <div className="w-12 h-12 rounded-full bg-rain-accent/10 border border-rain-accent/30 flex items-center justify-center rain-glow-soft">
            <Upload className="w-5 h-5 text-rain-accent" />
          </div>
        )}
        <div>
          <div className="text-sm font-semibold mb-1">
            {isLoading ? 'Decoding audio...' : isDragging ? 'Drop to load' : 'Drop audio file or click to browse'}
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">
            WAV · MP3 · FLAC · AAC · OGG · M4A · AIFF — up to 200 MB
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground italic">
          Audio never leaves your device on the free path
        </div>
        {/* Load Demo link */}
        <button
          onClick={handleLoadDemo}
          disabled={demoLoading}
          // AUDIT2 note: pointer-events-none on the disabled button so Firefox
          // doesn't propagate the click up to the parent's onClick (which opens
          // the file picker). Combined with handleLoadDemo's stopPropagation.
          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-rain-accent hover:bg-rain-accent/10 transition-colors disabled:opacity-50 disabled:pointer-events-none"
        >
          {demoLoading ? (
            <span className="animate-pulse">Loading...</span>
          ) : (
            <>
              <Zap className="w-3 h-3" />
              <span>Load Demo Track</span>
            </>
          )}
        </button>
      </motion.div>
      {error && (
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-red-400">
          <X className="w-3 h-3" />
          {error}
        </div>
      )}
    </div>
  )
}
