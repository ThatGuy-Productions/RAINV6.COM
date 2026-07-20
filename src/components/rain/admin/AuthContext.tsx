'use client'

/**
 * RAIN V6 — Client-side auth (Enterprise Admin Door)
 *
 * React context + hook that mirrors the server session. On mount it calls
 * `GET /api/rain/auth/me` to hydrate the authenticated user (or null).
 * Login / bootstrap / logout POST to the API routes; the httpOnly cookie
 * is set by the server, so subsequent fetches are automatically authed.
 *
 * Used by the AdminDoorModal trigger and the AdminConsole — and by any
 * component that wants to show tier-gated affordances when an Enterprise
 * admin is signed in.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export interface AuthUser {
  id: string
  email: string
  name: string | null
  tier: string
  createdAt: string
}

interface AuthState {
  user: AuthUser | null
  loading: boolean
  /** Convenience: true when an Enterprise-tier admin is signed in. */
  isEnterprise: boolean
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  bootstrap: (email: string, password: string, name?: string) => Promise<{ ok: boolean; error?: string }>
  /** Public free-tier registration. Creates the account + auto-logs-in.
   *  Passes the browser's anonId so pre-signup anonymous activity is
   *  attributed to the new account in the activation/retention funnel. */
  register: (email: string, password: string, name?: string, anonId?: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/rain/auth/me', { cache: 'no-store' })
      if (!res.ok) {
        setUser(null)
        return
      }
      const data = (await res.json()) as { user: AuthUser | null }
      setUser(data.user)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(
    async (email: string, password: string) => {
      try {
        const res = await fetch('/api/rain/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        const data = (await res.json()) as { user?: AuthUser; error?: string }
        if (!res.ok || !data.user) {
          return { ok: false, error: data.error ?? 'Login failed' }
        }
        setUser(data.user)
        return { ok: true }
      } catch {
        return { ok: false, error: 'Network error' }
      }
    },
    [],
  )

  const bootstrap = useCallback(
    async (email: string, password: string, name?: string) => {
      try {
        const res = await fetch('/api/rain/admin/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name }),
        })
        const data = (await res.json()) as { user?: AuthUser; error?: string }
        if (!res.ok || !data.user) {
          return { ok: false, error: data.error ?? 'Setup failed' }
        }
        setUser(data.user)
        return { ok: true }
      } catch {
        return { ok: false, error: 'Network error' }
      }
    },
    [],
  )

  const logout = useCallback(async () => {
    try {
      await fetch('/api/rain/auth/logout', { method: 'POST' })
    } catch {
      // ignore — clear local state regardless
    }
    setUser(null)
  }, [])

  const register = useCallback(
    async (email: string, password: string, name?: string, anonId?: string) => {
      try {
        const res = await fetch('/api/rain/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name, anonId }),
        })
        const data = (await res.json()) as { user?: AuthUser; error?: string; note?: string }
        if (!res.ok || !data.user) {
          return { ok: false, error: data.error ?? 'Registration failed' }
        }
        setUser(data.user)
        return { ok: true }
      } catch {
        return { ok: false, error: 'Network error' }
      }
    },
    [],
  )

  const value: AuthState = {
    user,
    loading,
    isEnterprise: user?.tier === 'enterprise',
    login,
    bootstrap,
    register,
    logout,
    refresh,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
