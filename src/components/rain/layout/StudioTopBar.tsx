'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bell, Circle, Cpu, Keyboard, Lock, Zap, ShieldCheck, UserPlus, LogIn, LogOut, Mail, ChevronDown } from 'lucide-react'
import { useSessionStore } from '@/lib/rain/store'
import { RAIN_BRAND } from '@/lib/rain/constants'
import { useAuth } from '@/components/rain/admin/AuthContext'

interface StudioTopBarProps {
  onExit: () => void
}

export function StudioTopBar({ onExit }: StudioTopBarProps) {
  const status = useSessionStore((s) => s.status)
  const fileName = useSessionStore((s) => s.fileName)
  const sessionId = useSessionStore((s) => s.sessionId)
  const rainScore = useSessionStore((s) => s.rainScore)
  const { user, isEnterprise, loading: authLoading, logout } = useAuth()

  const statusColor =
    status === 'processing' ? '#F97316'
    : status === 'complete' ? '#AAFF00'
    : status === 'failed' ? '#EF4444'
    : status === 'analyzing' ? '#00D4FF'
    : '#64748B'

  return (
    <header
      className="sticky top-0 z-30 backdrop-blur-xl bg-[rgba(18,20,26,0.65)] border-b border-[rgba(170,255,0,0.12)]"
      style={{ boxShadow: '0 8px 32px -8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)' }}
    >
      <div className="h-14 px-4 flex items-center justify-between gap-4">
        {/* Left */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onExit}
            className="p-1.5 rounded-md hover:bg-rain-surface-3 transition-colors"
            aria-label="Back to landing"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-rain-accent flex items-center justify-center">
              <span className="font-mono font-bold text-black text-xs">R∞</span>
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-semibold leading-tight">
                {RAIN_BRAND.name} <span className="text-rain-accent">V6</span>
              </div>
              <div className="text-[10px] text-muted-foreground font-mono leading-tight">
                Studio · {sessionId ? sessionId.slice(0, 8) : 'no session'}
              </div>
            </div>
          </div>
        </div>

        {/* Center — file info */}
        <div className="hidden md:flex items-center gap-3 px-3 py-1.5 rounded-md bg-rain-surface-2 border border-rain-border min-w-0 max-w-md">
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 ${status === 'processing' ? 'rain-pulse' : ''}`}
            style={{ background: statusColor }}
          />
          <span className="text-xs text-muted-foreground truncate">
            {fileName ?? 'No file loaded'}
          </span>
          {fileName && (
            <span className="text-[10px] text-muted-foreground font-mono flex-shrink-0">
              {useSessionStore.getState().fileSampleRate / 1000}kHz · {useSessionStore.getState().fileBitDepth}-bit
            </span>
          )}
        </div>

        {/* Right */}
        <div className="flex items-center gap-2">
          {rainScore && (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rain-surface-2 border border-rain-border">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">RAIN</span>
              <span className="text-sm font-bold rain-gradient-text-lime">{rainScore.overall}</span>
            </div>
          )}
          <StatusPill icon={<Cpu className="w-3 h-3" />} label="WASM" color="#AAFF00" />
          <StatusPill icon={<Lock className="w-3 h-3" />} label="Ed25519" color="#10B981" />
          <StatusPill icon={<Zap className="w-3 h-3" />} label="48kHz" color="#F97316" />
          {/* Account area.
              - Not signed in: "Sign In" (ghost) + "Sign Up" (primary) — gives
                returning users a clear entry point alongside the signup CTA.
              - Signed in (any tier): avatar chip dropdown with account info,
                quick links, and a Log Out action. Enterprise admins also get
                a "Console" link. */}
          {user ? (
            <AccountMenu user={user} isEnterprise={isEnterprise} onLogout={() => { void logout() }} />
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('rain:signin-open'))}
                disabled={authLoading}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono text-muted-foreground hover:text-[#AAFF00] hover:bg-[rgba(170,255,0,0.06)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Sign in to your account"
                title="Sign in to an existing account"
              >
                <LogIn className="w-3 h-3" />
                <span className="hidden sm:inline">Sign In</span>
              </button>
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('rain:signup-open'))}
                disabled={authLoading}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#AAFF00] text-black text-[11px] font-bold hover:bg-[#c5ff4a] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Sign up for a free account"
                title="Create a free account to persist your sessions and renders"
              >
                <UserPlus className="w-3 h-3" />
                <span>Sign Up</span>
              </button>
            </div>
          )}
          {/* Enterprise Admin Door trigger.
              - Not signed in: discreet lock icon → opens login/setup modal.
              - Signed in as enterprise: green shield → opens console directly.
              The trigger dispatches a window event that StudioApp listens for,
              keeping this component decoupled from the overlay state. */}
          <button
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent(
                  isEnterprise ? 'rain:admin-console-open' : 'rain:admin-door-open',
                ),
              )
            }
            className="relative p-1.5 rounded-md transition-colors group"
            style={{
              background: isEnterprise ? 'rgba(16,185,129,0.12)' : undefined,
              border: isEnterprise
                ? '1px solid rgba(16,185,129,0.4)'
                : '1px solid transparent',
            }}
            aria-label={
              isEnterprise ? 'Open Enterprise admin console' : 'Enterprise admin door'
            }
            title={
              isEnterprise
                ? `Enterprise console · ${user?.email}`
                : 'Enterprise admin door'
            }
          >
            {isEnterprise ? (
              <ShieldCheck className="w-4 h-4 text-[#10B981]" />
            ) : (
              <Lock
                className={`w-4 h-4 ${
                  authLoading ? 'text-muted-foreground/40' : 'text-muted-foreground group-hover:text-[#AAFF00]'
                } transition-colors`}
              />
            )}
            {isEnterprise && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10B981] opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#10B981]" />
              </span>
            )}
          </button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('rain:shortcuts-toggle'))}
            className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-rain-surface-2 border border-rain-border text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-rain-accent hover:border-rain-accent/30 transition-colors"
            aria-label="Keyboard shortcuts"
            title="Keyboard Shortcuts (?)"
          >
            <Keyboard className="w-3 h-3" />
            <span>Shortcuts</span>
          </button>
          <button
            className="p-1.5 rounded-md hover:bg-rain-surface-3 transition-colors relative"
            aria-label="Notifications"
          >
            <Bell className="w-4 h-4" />
            <Circle className="absolute top-1 right-1 w-1.5 h-1.5 fill-rain-accent text-rain-accent" />
          </button>
        </div>
      </div>
    </header>
  )
}

function StatusPill({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <div
      className="hidden lg:flex items-center gap-1 px-2 py-1 rounded-md bg-rain-surface-2 border border-rain-border text-[10px] font-mono uppercase tracking-wider"
      style={{ color }}
    >
      {icon}
      {label}
    </div>
  )
}

/**
 * Account dropdown menu — custom (non-Radix) implementation.
 *
 * Uses a simple state toggle + click-outside-to-close + Esc-to-close. The
 * Radix DropdownMenu trigger didn't reliably toggle in the headless browser
 * test environment (pointer events not firing), so this keeps the same
 * visual design with a more robust interaction model.
 */
function AccountMenu({
  user,
  isEnterprise,
  onLogout,
}: {
  user: { email: string; name: string | null; tier: string }
  isEnterprise: boolean
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on click outside.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const initial = (user.name || user.email)[0].toUpperCase()

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[rgba(170,255,0,0.08)] border border-[rgba(170,255,0,0.25)] text-[11px] font-mono hover:bg-[rgba(170,255,0,0.14)] hover:border-[rgba(170,255,0,0.45)] transition-all group"
        title={`Signed in as ${user.email}`}
        aria-label={`Account menu: ${user.email}`}
        aria-expanded={open}
      >
        <span className="w-5 h-5 rounded-full bg-[#AAFF00] text-black text-[10px] font-bold flex items-center justify-center flex-shrink-0">
          {initial}
        </span>
        <span className="hidden sm:inline text-[#AAFF00] max-w-[100px] truncate">
          {user.name || user.email.split('@')[0]}
        </span>
        <ChevronDown
          className={`w-3 h-3 text-muted-foreground group-hover:text-[#AAFF00] transition-all flex-shrink-0 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 w-64 rounded-xl border border-[rgba(170,255,0,0.2)] bg-[rgba(14,16,22,0.98)] shadow-2xl overflow-hidden z-50"
          style={{ boxShadow: '0 24px 80px -12px rgba(0,0,0,0.8)' }}
          role="menu"
        >
          {/* Account header */}
          <div className="px-3 py-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-full bg-[#AAFF00] text-black text-base font-bold flex items-center justify-center flex-shrink-0">
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">
                  {user.name || user.email.split('@')[0]}
                </div>
                <div className="text-[10px] text-muted-foreground font-mono truncate">
                  {user.email}
                </div>
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-1.5">
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider"
                style={{
                  background: isEnterprise ? 'rgba(16,185,129,0.15)' : 'rgba(170,255,0,0.12)',
                  color: isEnterprise ? '#10B981' : '#AAFF00',
                  border: `1px solid ${isEnterprise ? 'rgba(16,185,129,0.4)' : 'rgba(170,255,0,0.3)'}`,
                }}
              >
                {user.tier} tier
              </span>
            </div>
          </div>

          {/* Menu items */}
          <div className="py-1">
            {isEnterprise && (
              <MenuButton
                icon={<ShieldCheck className="w-3.5 h-3.5 text-[#10B981]" />}
                label="Open admin console"
                onClick={() => {
                  setOpen(false)
                  window.dispatchEvent(new CustomEvent('rain:admin-console-open'))
                }}
              />
            )}
            <MenuButton
              icon={<Mail className="w-3.5 h-3.5 text-muted-foreground" />}
              label="Account & sessions"
              onClick={() => {
                setOpen(false)
                window.dispatchEvent(new CustomEvent('rain:admin-door-open'))
              }}
            />
          </div>

          {/* Logout */}
          <div className="border-t border-white/[0.06] py-1">
            <MenuButton
              icon={<LogOut className="w-3.5 h-3.5" />}
              label="Log out"
              variant="danger"
              onClick={() => {
                setOpen(false)
                onLogout()
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function MenuButton({
  icon,
  label,
  onClick,
  variant = 'default',
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  variant?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
        variant === 'danger'
          ? 'text-red-400 hover:bg-red-500/10'
          : 'hover:bg-[rgba(170,255,0,0.08)]'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
