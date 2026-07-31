'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { XCircle, Clock, Zap } from 'lucide-react'
import { useSessionStore } from '@/lib/rain/store'
import { PIPELINE_STAGES } from '@/lib/rain/constants'

// Confetti particle for completion celebration
function ConfettiParticle({ 
  x, 
  y, 
  color, 
  delay, 
  angle 
}: { 
  x: number
  y: number
  color: string
  delay: number
  angle: number 
}) {
  const angleRad = (angle * Math.PI) / 180
  const distance = 60 + Math.random() * 40
  
  return (
    <motion.div
      className="absolute w-2 h-3 rounded-sm"
      style={{ 
        left: x, 
        top: y, 
        backgroundColor: color,
        transform: `rotate(${angle}deg)`
      }}
      initial={{ scale: 0, opacity: 1, x: 0, y: 0 }}
      animate={{
        scale: [0, 1, 0.5],
        opacity: [1, 1, 0],
        x: Math.cos(angleRad) * distance,
        y: Math.sin(angleRad) * distance - 20,
      }}
      transition={{ 
        duration: 1.2, 
        delay,
        ease: [0.25, 0.46, 0.45, 0.94]
      }}
    />
  )
}

// Completion celebration overlay
function CompletionCelebration() {
  const colors = ['#AAFF00', '#8B5CF6', '#00D4FF', '#F97316', '#D946EF', '#06B6D4']
  const particles = Array.from({ length: 24 }, (_, i) => ({
    x: 50,
    y: 50,
    color: colors[i % colors.length],
    delay: i * 0.02,
    angle: (i * 15) + Math.random() * 10
  }))
  
  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center pointer-events-none z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { delay: 1.5 } }}
    >
      {/* Success burst */}
      <motion.div
        className="absolute"
        initial={{ scale: 0 }}
        animate={{ scale: [0, 1.2, 0] }}
        transition={{ duration: 0.5 }}
      >
        <div className="w-20 h-20 rounded-full bg-rain-accent/30 blur-xl" />
      </motion.div>
      
      {/* Confetti particles */}
      <div className="absolute inset-0 flex items-center justify-center" style={{ transform: 'translate(-50%, -50%)' }}>
        {particles.map((p, i) => (
          <ConfettiParticle key={i} {...p} />
        ))}
      </div>
      
      {/* Success text */}
      <motion.div
        className="text-center"
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.3, type: 'spring' }}
      >
        <Zap className="w-8 h-8 text-rain-accent mx-auto mb-2" />
        <div className="text-sm font-bold text-rain-accent">Complete!</div>
      </motion.div>
    </motion.div>
  )
}

export function ProcessingProgressPanel() {
  const isProcessing = useSessionStore((s) => s.isProcessing)
  const progress = useSessionStore((s) => s.progress)
  const activeStage = useSessionStore((s) => s.activeStage)
  const processingStartTime = useSessionStore((s) => s.processingStartTime)
  const fileDuration = useSessionStore((s) => s.fileDuration)
  const cancelProcessing = useSessionStore((s) => s.cancelProcessing)
  const showCompletionCelebration = useSessionStore((s) => s.showCompletionCelebration)
  const clearCompletionCelebration = useSessionStore((s) => s.clearCompletionCelebration)
  const hasProcessed = useSessionStore((s) => s.hasProcessed)
  
  // Estimated time remaining calculation
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<number | null>(null)
  const lastProgressRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(Date.now())
  
  useEffect(() => {
    if (!isProcessing || !processingStartTime) {
      setEstimatedTimeRemaining(null)
      return
    }
    
    // Calculate rate of progress
    const now = Date.now()
    const elapsed = now - processingStartTime

    // Estimate based on elapsed time and progress rate
    if (elapsed > 1000 && progress > 5) {
      // Use average rate estimation
      const avgRate = progress / (elapsed / 1000) // % per second
      const remainingProgress = 100 - progress
      const estimatedRemaining = remainingProgress / avgRate
      setEstimatedTimeRemaining(Math.max(0, Math.round(estimatedRemaining)))
    } else {
      // Initial estimate based on file duration (rough heuristic)
      // Processing typically takes ~1-3x the file duration
      if (fileDuration > 0) {
        const baseEstimate = fileDuration * 1.5 // seconds
        const progressFraction = progress / 100
        const remainingEstimate = baseEstimate * (1 - progressFraction)
        setEstimatedTimeRemaining(Math.max(0, Math.round(remainingEstimate)))
      }
    }
    
    lastProgressRef.current = progress
    lastTimeRef.current = now
  }, [isProcessing, progress, processingStartTime, fileDuration])
  
  // Clear celebration after it shows
  useEffect(() => {
    if (showCompletionCelebration) {
      setTimeout(() => clearCompletionCelebration(), 2000)
    }
  }, [showCompletionCelebration, clearCompletionCelebration])
  
  // Show celebration when processing completes
  useEffect(() => {
    if (!isProcessing && hasProcessed && progress === 100) {
      // Small delay to let the UI settle
      setTimeout(() => {
        useSessionStore.getState().triggerCompletionCelebration()
      }, 200)
    }
  }, [isProcessing, hasProcessed, progress])
  
  // Format time remaining
  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}m ${secs}s`
  }
  
  // Get current stage info
  const currentStageName = PIPELINE_STAGES[activeStage - 1]?.name ?? 'Initializing'
  
  if (!isProcessing && !showCompletionCelebration) return null
  
  return (
    <AnimatePresence>
      {(isProcessing || showCompletionCelebration) && (
        <motion.div
          className="rain-panel rounded-lg p-4 relative overflow-hidden"
          initial={{ opacity: 0, y: -10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95, transition: { duration: 0.2 } }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        >
          {/* Completion celebration overlay */}
          <AnimatePresence>
            {showCompletionCelebration && (
              <CompletionCelebration />
            )}
          </AnimatePresence>
          
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <motion.div
                className="w-2 h-2 rounded-full bg-rain-accent"
                animate={isProcessing ? { 
                  scale: [1, 1.3, 1],
                  opacity: [1, 0.7, 1]
                } : { scale: 1, opacity: 1 }}
                transition={{ duration: 0.8, repeat: Infinity }}
              />
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Processing Progress
              </div>
            </div>
            
            {/* Cancel button */}
            {isProcessing && (
              <motion.button
                onClick={() => cancelProcessing()}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 transition-colors text-[10px] font-mono text-red-400"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <XCircle className="w-3 h-3" />
                Cancel
              </motion.button>
            )}
          </div>
          
          {/* Overall progress bar */}
          <div className="relative mb-3">
            {/* Background track */}
            <div className="h-6 bg-rain-surface-2 rounded-lg overflow-hidden relative">
              {/* Progress fill */}
              <motion.div
                className="h-full bg-gradient-to-r from-rain-accent/40 via-rain-accent to-rain-accent/80 rounded-lg"
                initial={{ width: '0%' }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              />
              
              {/* Shimmer effect */}
              {isProcessing && (
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                />
              )}
              
              {/* Percentage text inside bar */}
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-mono font-bold text-black/80">
                  {Math.round(progress)}%
                </span>
              </div>
            </div>
            
            {/* Stage markers */}
            <div className="absolute inset-0 h-6 flex items-center pointer-events-none">
              {Array.from({ length: 16 }, (_, i) => (
                <div 
                  key={i}
                  className="flex-1 border-r border-rain-border/30 last:border-r-0 h-full"
                />
              ))}
            </div>
          </div>
          
          {/* Current stage info */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-rain-surface-2/60 rounded-md p-2">
              <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
                Current Stage
              </div>
              <div className="text-sm font-semibold text-foreground">
                Stage {String(activeStage).padStart(2, '0')}: {currentStageName}
              </div>
            </div>
            
            <div className="bg-rain-surface-2/60 rounded-md p-2">
              <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Est. Remaining
              </div>
              <div className="text-sm font-semibold text-foreground">
                {estimatedTimeRemaining !== null 
                  ? formatTime(estimatedTimeRemaining)
                  : 'Calculating...'}
              </div>
            </div>
          </div>
          
          {/* Stage progress details */}
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded bg-rain-accent" />
              <span className="text-muted-foreground">Completed: {activeStage - 1}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded bg-rain-accent animate-pulse" />
              <span className="text-muted-foreground">Active: 1</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded bg-rain-surface-2 border border-rain-border" />
              <span className="text-muted-foreground">Pending: {16 - activeStage}</span>
            </div>
          </div>
          
          {/* Processing note */}
          <div className="mt-3 pt-2 border-t border-rain-border/30 text-[9px] font-mono text-muted-foreground/70 text-center">
            All 16 stages process sequentially. Audio quality validated after each stage.
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}