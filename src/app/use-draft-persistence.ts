import { useCallback, useEffect, useRef, useState } from 'react'
import { captureDraft, DraftConflict, openDraftStore, type DraftStore } from './draft-store'
import type { StudioState } from './studio-state'

export type DraftStatus = 'loading' | 'ready' | 'saving' | 'saved' | 'load-error' | 'save-error' | 'conflict'

type Snapshot = ReturnType<typeof captureDraft>
interface DraftSession {
  readonly store: DraftStore
  pending: Snapshot | null
  writing: boolean
  conflicted: boolean
}

export function useDraftPersistence(restore: (store: DraftStore) => void) {
  const [status, setStatus] = useState<DraftStatus>(() => typeof indexedDB === 'undefined' ? 'load-error' : 'loading')
  const session = useRef<DraftSession | null>(null)
  const unsaved = useRef(false)

  useEffect(() => {
    if (typeof indexedDB === 'undefined') return
    let disposed = false
    void openDraftStore().then((store) => {
      if (disposed) {
        store.close()
        return
      }
      try {
        restore(store)
        session.current = { store, pending: null, writing: false, conflicted: false }
        setStatus(store.snapshot?.state.markdown ? 'saved' : 'ready')
      } catch {
        store.close()
        setStatus('load-error')
      }
    }, () => {
      if (!disposed) setStatus('load-error')
    })
    return () => {
      disposed = true
      session.current?.store.close()
      session.current = null
    }
  }, [restore])

  useEffect(() => {
    if (status !== 'saving' && status !== 'save-error' && status !== 'load-error' && status !== 'conflict') return
    const warnOnExit = (event: BeforeUnloadEvent) => {
      if (!unsaved.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnOnExit)
    return () => window.removeEventListener('beforeunload', warnOnExit)
  }, [status])

  const save = useCallback((state: StudioState, images: ReadonlyMap<string, Blob>) => {
    unsaved.current = true
    const current = session.current
    if (!current || current.conflicted) return
    current.pending = captureDraft(state, images)
    if (current.writing) return
    setStatus('saving')
    current.writing = true
    // Start the first write in the input event, not in an idle callback or on unload.
    // While it commits, keep only the newest snapshot rather than queueing every keystroke.
    void (async () => {
      try {
        while (current.pending && session.current === current) {
          const next = current.pending
          current.pending = null
          await current.store.save(next)
        }
        if (session.current !== current) return
        unsaved.current = false
        setStatus('saved')
      } catch (error) {
        if (session.current !== current) return
        current.conflicted = error instanceof DraftConflict
        setStatus(current.conflicted ? 'conflict' : 'save-error')
      } finally {
        current.writing = false
        current.pending = null
      }
    })()
  }, [])

  return { status, save }
}
