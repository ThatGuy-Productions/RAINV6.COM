'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Pause, Play, RotateCcw, Repeat, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { audioEngine } from '@/lib/rain/audio-engine'
import { useSessionStore } from '@/lib/rain/store'

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.floor((s * 1000) % 1000)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

/** Compute a normalized waveform summary (0–1 values) from audio channel data. */
function computeWaveformBars(channels: Float32Array[], barCount: number): number[] {
  if (!channels.length) return []
  // Mix to mono
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
  // Normalize to 0–1
  const max = Math.max(...bars, 0.0001)
  return bars.map((b) => b / max)
}

export function StudioTransportBar() {
  const hasProcessed = useSessionStore((s) => s.hasProcessed)
  const fileName = useSessionStore((s) => s.fileName)
  const abMode = useSessionStore((s) => s.abMode)
  const setAbMode = useSessionStore((s) => s.setAbMode)
  const [isPlaying, setIsPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1.0)
  const [isLooping, setIsLooping] = useState(false)
  const rafRef = useRef<number | null>(null)

  // Compute waveform overview reactively when file changes
  const waveformData = useMemo(() => {
    if (!fileName) return []
    const channels = audioEngine.getInputChannels()
    if (channels && channels.length > 0) {
      return computeWaveformBars(channels, 200)
    }
    return []
  }, [fileName])

  // Sync audio engine preview mode with store abMode
  const handleAbModeChange = useCallback((mode: 'original' | 'mastered') => {
    setAbMode(mode)
    const engineMode = mode === 'original' ? 'A' : 'B'
    audioEngine.setPreviewMode(engineMode)
  }, [setAbMode])

  useEffect(() => {
    const unsub = audioEngine.subscribe((s) => {
      setIsPlaying(s.isPlaying)
      setDuration(s.duration)
      setVolume(s.volume)
      // Sync store abMode with engine previewMode
      const engineAbMode = s.previewMode === 'A' ? 'original' : 'mastered'
      if (useSessionStore.getState().abMode !== engineAbMode) {
        setAbMode(engineAbMode)
      }
    })
    return unsub
  }, [setAbMode])

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      return
    }
    const tick = () => {
      setPosition(audioEngine.position)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [isPlaying])

  const togglePlay = async () => {
    await audioEngine.init()
    audioEngine.togglePlay()
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (duration === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    audioEngine.seek(ratio * duration)
    setPosition(ratio * duration)
  }

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    setVolume(v)
    audioEngine.setVolume(v)
  }

  const toggleLoop = useCallback(() => {
    const next = !isLooping
    setIsLooping(next)
    audioEngine.setLoop(next)
  }, [isLooping])

  const disabled = !fileName

  // Volume slider fill color based on level
  const volumeColor = volume <= 0.7 ? '#22c55e' : volume <= 0.9 ? '#eab308' : '#ef4444'
  const volumeFillPct = volume * 100

  return (
    <div
      className="backdrop-blur-xl bg-[rgba(18,20,26,0.65)] border-t border-[rgba(170,255,0,0.12)] px-4 py-2.5 flex items-center gap-4"
      style={{ boxShadow: '0 8px 32px -8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)' }}
    >
      {/* Transport controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => audioEngine.seek(Math.max(0, position - 10))}
          disabled={disabled}
          className="p-1.5 rounded-md hover:bg-rain-surface-3 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Skip back 10s"
        >
          <SkipBack className="w-4 h-4" />
        </button>
        <div className="relative">
          <button
            onClick={togglePlay}
            disabled={disabled}
            className="w-9 h-9 rounded-full bg-rain-accent text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 rain-glow-soft"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          {/* A/B mode badge near play button */}
          {hasProcessed && (
            <div
              className={`absolute -top-1 -right-1 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase ${
                abMode === 'original'
                  ? 'bg-orange-500/90 text-white'
                  : 'bg-rain-accent/90 text-black'
              }`}
              aria-label={`Playing ${abMode}`}
            >
              {abMode === 'original' ? 'A' : 'B'}
            </div>
          )}
        </div>
        <button
          onClick={() => audioEngine.seek(Math.min(duration, position + 10))}
          disabled={disabled}
          className="p-1.5 rounded-md hover:bg-rain-surface-3 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Skip forward 10s"
        >
          <SkipForward className="w-4 h-4" />
        </button>
        <button
          onClick={() => { audioEngine.stop(); audioEngine.seek(0); setPosition(0) }}
          disabled={disabled}
          className="p-1.5 rounded-md hover:bg-rain-surface-3 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Stop"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        {/* Loop toggle */}
        <button
          onClick={toggleLoop}
          disabled={disabled}
          className={`p-1.5 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
            isLooping
              ? 'text-rain-accent hover:bg-rain-accent/10'
              : 'hover:bg-rain-surface-3 text-muted-foreground'
          }`}
          aria-label={isLooping ? 'Disable loop' : 'Enable loop'}
        >
          <Repeat className="w-4 h-4" />
        </button>
      </div>

      {/* Time + waveform scrubber */}
      <div className="flex-1 flex items-center gap-3 min-w-0">
        <span className="text-xs font-mono text-muted-foreground tabular-nums w-28 text-right">
          {formatTime(position)}
        </span>
        <div
          onClick={handleSeek}
          className="flex-1 h-8 rounded-md bg-rain-surface-2 border border-rain-border relative overflow-hidden cursor-pointer group"
        >
          <div className="absolute inset-0 flex items-center px-1 gap-px pointer-events-none">
            {waveformData.length === 200
              ? waveformData.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-full transition-opacity"
                    style={{
                      height: `${15 + h * 75}%`,
                      background:
                        i / 200 < position / (duration || 1)
                          ? '#AAFF00'
                          : 'rgba(170, 255, 0, 0.2)',
                    }}
                  />
                ))
              : // Fallback: static waveform when no audio loaded
                Array.from({ length: 200 }).map((_, i) => {
                  const h =
                    20 + Math.abs(Math.sin(i * 0.4) * 50) + Math.abs(Math.cos(i * 0.18) * 30)
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-full transition-opacity"
                      style={{
                        height: `${Math.min(80, h)}%`,
                        background:
                          i / 200 < position / (duration || 1)
                            ? '#AAFF00'
                            : 'rgba(170, 255, 0, 0.2)',
                      }}
                    />
                  )
                })}
          </div>
          {/* Playhead with glow */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-rain-accent pointer-events-none z-10"
            style={{
              left: `${duration > 0 ? (position / duration) * 100 : 0}%`,
              boxShadow: '0 0 8px rgba(170, 255, 0, 0.5)',
            }}
          />
        </div>
        <span className="text-xs font-mono text-muted-foreground tabular-nums w-28">
          {formatTime(duration)}
        </span>
      </div>

      {/* A/B preview toggle with labels — synced with store */}
      <div className="flex items-center gap-1.5">
        <div className="flex flex-col items-center gap-0.5">
          <div className="flex items-center gap-1 p-0.5 rounded-md bg-rain-surface-2 border border-rain-border">
            <button
              onClick={() => handleAbModeChange('original')}
              disabled={!fileName}
              className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition-colors disabled:opacity-30 ${
                abMode === 'original'
                  ? 'bg-orange-500/80 text-white'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-label="Preview original (A)"
            >
              A
            </button>
            <button
              onClick={() => handleAbModeChange('mastered')}
              disabled={!hasProcessed}
              className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                abMode === 'mastered'
                  ? 'bg-rain-accent text-black'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-label="Preview mastered (B)"
            >
              B
            </button>
          </div>
          <span className="text-[9px] font-mono tracking-wider uppercase text-muted-foreground">
            {abMode === 'original' ? 'Original' : 'Mastered'}
          </span>
        </div>
      </div>

      {/* Volume slider with level color */}
      <div className="hidden md:flex items-center gap-2 w-32">
        <Volume2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <div className="relative flex-1 h-4 flex items-center">
          {/* Colored fill track behind the slider */}
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1 rounded-full pointer-events-none"
            style={{
              width: `${volumeFillPct}%`,
              background: volumeColor,
              transition: 'width 0.1s, background 0.2s',
            }}
          />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={handleVolume}
            className="rain-range flex-1 relative z-10"
            style={{
              background: 'transparent',
            }}
            aria-label="Volume"
          />
        </div>
      </div>
    </div>
  )
}
