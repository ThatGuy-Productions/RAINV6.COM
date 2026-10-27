import { describe, expect, it } from 'bun:test'
import { persistEvent, type EventType } from '../../src/lib/rain/server-analytics'

function fakeStore(options?: {
  eventCreate?: () => Promise<unknown>
  accountUpdate?: () => Promise<unknown>
}) {
  const created: Array<{ data: { userId: string | null; anonId: string | null; type: EventType; metadata: string | null } }> = []
  return {
    created,
    store: {
      event: {
        create: async (args: typeof created[number]) => {
          created.push(args)
          return options?.eventCreate ? options.eventCreate() : { id: 'event-1' }
        },
      },
      account: {
        update: async () => options?.accountUpdate ? options.accountUpdate() : { id: 'account-1' },
      },
    },
  }
}

describe('future beta telemetry persistence', () => {
  it('stores anonymous usage events without requiring an account', async () => {
    const { store, created } = fakeStore()
    const ok = await persistEvent(store, {
      userId: null,
      anonId: 'browser-session-123',
      type: 'export_completed',
      metadata: { format: 'wav24', durationMs: 900 },
    })

    expect(ok).toBe(true)
    expect(created).toHaveLength(1)
    expect(created[0].data.userId).toBeNull()
    expect(created[0].data.anonId).toBe('browser-session-123')
    expect(JSON.parse(created[0].data.metadata ?? '{}')).toEqual({ format: 'wav24', durationMs: 900 })
  })

  it('reports a failed event write instead of claiming telemetry was recorded', async () => {
    const { store } = fakeStore({ eventCreate: async () => { throw new Error('database unavailable') } })
    const ok = await persistEvent(store, {
      anonId: 'browser-session-123',
      type: 'session_created',
    })

    expect(ok).toBe(false)
  })

  it('keeps a successfully written event successful if the optional account activity update fails', async () => {
    const { store } = fakeStore({ accountUpdate: async () => { throw new Error('activity update unavailable') } })
    const ok = await persistEvent(store, {
      userId: 'account-1',
      type: 'render_completed',
    })

    expect(ok).toBe(true)
  })
})
