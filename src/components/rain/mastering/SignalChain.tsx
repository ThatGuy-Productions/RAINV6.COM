'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Check, Loader2 } from 'lucide-react'
import { useSessionStore } from '@/lib/rain/store'
import { PIPELINE_STAGES } from '@/lib/rain/constants'

// Progress bar animation variants
const progressBarVariants = {
  hidden: { width: '0%' },
  visible: (progress: number) => ({
    width: `${progress}%`,
    transition: { duration: 0.3, ease: 'easeOut' }
  })
}

// Pulsing glow animation for active stage
const pulseGlowVariants = {
  pulse: {
    boxShadow: [
      '0 0 8px rgba(170, 255, 0, 0.3)',
      '0 0 16px rgba(170, 255, 0, 0.5)',
      '0 0 8px rgba(170, 255, 0, 0.3)'
    ],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: 'easeInOut'
    }
  }
}

// Checkmark animation variants - celebrates completion
const checkmarkVariants = {
  hidden: { scale: 0, rotate: -180 },
  visible: { 
    scale: 1, 
    rotate: 0,
    transition: { 
      type: 'spring', 
      stiffness: 500, 
      damping: 30,
      delay: 0.1
    }
  }
}

// Stage card animation for completion flash
const stageCardVariants = {
  pending: {
    borderColor: 'rgba(255, 255, 255, 0.1)',
    boxShadow: '0 0 0px rgba(170, 255, 0, 0)',
  },
  active: {
    borderColor: 'rgba(170, 255, 0, 1)',
    boxShadow: '0 0 12px rgba(170, 255, 0, 0.3)',
  },
  complete: {
    borderColor: 'rgba(170, 255, 0, 0.5)',
    boxShadow: '0 0 20px rgba(170, 255, 0, 0.4)',
    transition: { 
      duration: 0.4,
      boxShadow: {
        duration: 0.6,
        delay: 0.2
      }
    }
  },
  flashComplete: {
    borderColor: 'rgba(170, 255, 0, 0.5)',
    boxShadow: '0 0 0px rgba(170, 255, 0, 0)',
  }
}

export function SignalChain() {
  const pipeline = useSessionStore((s) => s.pipeline)
  const activeStage = useSessionStore((s) => s.activeStage)
  const status = useSessionStore((s) => s.status)
  const progress = useSessionStore((s) => s.progress)
  const isProcessing = useSessionStore((s) => s.isProcessing)
  const processingStageProgress = useSessionStore((s) => s.processingStageProgress)
  
  return (
    <div className="rain-panel rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          16-Stage Pipeline
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-mono text-muted-foreground">
            {activeStage}/16
          </div>
          {isProcessing && (
            <motion.div
              className="text-[10px] font-mono text-rain-accent"
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            >
              Processing...
            </motion.div>
          )}
        </div>
      </div>
      
      {/* Overall progress bar */}
      {isProcessing && (
        <motion.div 
          className="mb-3"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
        >
          <div className="h-1.5 bg-rain-surface-2 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-rain-accent/60 to-rain-accent rounded-full"
              initial={{ width: '0%' }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </div>
          <div className="flex justify-between text-[9px] font-mono text-muted-foreground mt-1">
            <span>{Math.round(progress)}% complete</span>
            <span>{PIPELINE_STAGES[activeStage - 1]?.name ?? 'Initializing'}</span>
          </div>
        </motion.div>
      )}
      
      {/* Stage grid */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
        {pipeline.map((stage, i) => {
          return (
            <motion.div
              key={stage.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.02 }}
              className="relative group"
              title={`${stage.id}. ${stage.name} — ${stage.description}`}
            >
              {/* Stage card with animated status */}
              <motion.div
                className={`aspect-square rounded-md flex items-center justify-center border relative overflow-hidden ${
                  stage.status === 'complete'
                    ? 'bg-rain-accent/10'
                    : stage.status === 'active'
                    ? 'bg-rain-accent/15'
                    : stage.status === 'failed'
                    ? 'bg-red-500/10'
                    : 'bg-rain-surface-2/60'
                }`}
                variants={stageCardVariants}
                animate={stage.status === 'complete' ? 'complete' : stage.status === 'active' ? 'active' : 'pending'}
                onAnimationComplete={() => {
                  // After flash completes, settle to final state
                }}
              >
                {/* Active stage pulsing glow */}
                {stage.status === 'active' && isProcessing && (
                  <motion.div
                    className="absolute inset-0 rounded-md"
                    variants={pulseGlowVariants}
                    animate="pulse"
                  />
                )}
                
                {/* Stage number */}
                <span
                  className={`text-xs font-mono font-bold relative z-10 ${
                    stage.status === 'complete'
                      ? 'text-rain-accent'
                      : stage.status === 'active'
                      ? 'text-rain-accent'
                      : stage.status === 'failed'
                      ? 'text-red-500'
                      : 'text-muted-foreground'
                  }`}
                >
                  {String(stage.id).padStart(2, '0')}
                </span>
                
                {/* Active stage spinner */}
                <AnimatePresence>
                  {stage.status === 'active' && isProcessing && (
                    <motion.div
                      key={`spinner-${stage.id}`}
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      className="absolute -top-1 -right-1"
                    >
                      <Loader2 className="w-3 h-3 text-rain-accent animate-spin" />
                    </motion.div>
                  )}
                </AnimatePresence>
                
                {/* Completed checkmark with celebration animation */}
                <AnimatePresence mode="wait">
                  {stage.status === 'complete' && (
                    <motion.div
                      key={`check-${stage.id}`}
                      variants={checkmarkVariants}
                      initial="hidden"
                      animate="visible"
                      exit="hidden"
                      className="absolute -top-1 -right-1"
                    >
                      <Check className="w-3 h-3 text-rain-accent bg-rain-surface rounded-full p-0.5" />
                    </motion.div>
                  )}
                </AnimatePresence>
                
                {/* Progress bar beneath active stage */}
                <AnimatePresence>
                  {stage.status === 'active' && isProcessing && (
                    <motion.div
                      key={`progress-${stage.id}`}
                      className="absolute bottom-0 left-0 right-0 h-1 bg-rain-surface-2 rounded-b-md overflow-hidden"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      <motion.div
                        className="h-full bg-rain-accent rounded-b-md"
                        variants={progressBarVariants}
                        custom={processingStageProgress}
                        initial="hidden"
                        animate="visible"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
                
                {/* Mini sparkle burst on completion */}
                <AnimatePresence>
                  {stage.status === 'complete' && (
                    <motion.div
                      key={`sparkle-${stage.id}`}
                      className="absolute inset-0 pointer-events-none"
                      initial={{ opacity: 1 }}
                      animate={{ 
                        opacity: [1, 0.8, 0],
                        scale: [1, 1.1, 0.9]
                      }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                    >
                      {/* Corner sparkles */}
                      <motion.div 
                        className="absolute top-0.5 left-0.5 w-1 h-1 bg-rain-accent rounded-full"
                        animate={{ scale: [0, 1.2, 0], opacity: [1, 0] }}
                        transition={{ duration: 0.4 }}
                      />
                      <motion.div 
                        className="absolute top-0.5 right-0.5 w-1 h-1 bg-rain-accent rounded-full"
                        animate={{ scale: [0, 1.2, 0], opacity: [1, 0] }}
                        transition={{ duration: 0.4, delay: 0.05 }}
                      />
                      <motion.div 
                        className="absolute bottom-0.5 left-0.5 w-1 h-1 bg-rain-accent rounded-full"
                        animate={{ scale: [0, 1.2, 0], opacity: [1, 0] }}
                        transition={{ duration: 0.4, delay: 0.1 }}
                      />
                      <motion.div 
                        className="absolute bottom-0.5 right-0.5 w-1 h-1 bg-rain-accent rounded-full"
                        animate={{ scale: [0, 1.2, 0], opacity: [1, 0] }}
                        transition={{ duration: 0.4, delay: 0.15 }}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
              
              {/* Tooltip */}
              <div className="absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block">
                <div className="bg-rain-surface-3 border border-rain-border rounded-md p-2 min-w-[160px] shadow-xl">
                  <div className="text-[10px] font-mono text-rain-accent mb-0.5">
                    Stage {String(stage.id).padStart(2, '0')}
                  </div>
                  <div className="text-xs font-semibold mb-1">{stage.name}</div>
                  <div className="text-[10px] text-muted-foreground leading-tight">{stage.description}</div>
                  {stage.status === 'active' && isProcessing && (
                    <div className="mt-1 pt-1 border-t border-rain-border/50">
                      <div className="text-[9px] font-mono text-rain-accent">
                        Progress: {Math.round(processingStageProgress)}%
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>
      
      {/* Processing status footer */}
      {status === 'processing' && (
        <motion.div 
          className="mt-3 flex items-center justify-between text-[10px] font-mono"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <span className="text-rain-accent flex items-center gap-1">
            <motion.span
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 0.5, repeat: Infinity }}
            >
              ●
            </motion.span>
            Processing...
          </span>
          <span className="text-muted-foreground">
            {pipeline[activeStage - 1]?.name ?? ''}
          </span>
        </motion.div>
      )}
    </div>
  )
}