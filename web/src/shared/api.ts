import { useEffect, useRef } from 'react'

export function createApi(key: string) {
  const token = () => sessionStorage.getItem(key)
  async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const form = body instanceof FormData
    const r = await fetch('/api' + path, {
      method,
      headers: { ...(body && !form ? { 'content-type': 'application/json' } : {}), ...(token() ? { authorization: `Bearer ${token()}` } : {}) },
      body: form ? body : body ? JSON.stringify(body) : undefined,
    })
    const data = await r.json().catch(() => null)
    if (!r.ok) {
      if (r.status === 401 && token() && !path.includes('/auth/')) { sessionStorage.removeItem(key); location.reload() }
      throw new Error(data?.error ?? r.statusText)
    }
    return data
  }
  // Documents need the auth header, so fetch as blob instead of a plain link.
  async function openDoc(path: string) {
    const r = await fetch('/api' + path, { headers: { authorization: `Bearer ${token()}` } })
    if (!r.ok) throw new Error('could not open document')
    window.open(URL.createObjectURL(await r.blob()), '_blank')
  }
  async function blobUrl(path: string) {
    const r = await fetch('/api' + path, { headers: { authorization: `Bearer ${token()}` } })
    if (!r.ok) throw new Error('could not load document')
    return URL.createObjectURL(await r.blob())
  }
  return {
    call, openDoc, blobUrl, token,
    setToken: (t: string) => sessionStorage.setItem(key, t),
    logout: () => { sessionStorage.removeItem(key); location.reload() },
  }
}
export type Api = ReturnType<typeof createApi>

// Server-sent events. Token in the query string is a demo shortcut (EventSource has no headers).
export function useSSE(api: Api, path: string, handlers: Record<string, () => void>) {
  const h = useRef(handlers)
  h.current = handlers
  useEffect(() => {
    const es = new EventSource(`/api${path}?token=${api.token()}`)
    for (const ev of Object.keys(handlers)) es.addEventListener(ev, () => h.current[ev]?.())
    return () => es.close()
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps
}

// Auto refresh: every `ms` while the tab is visible, plus immediately when it becomes visible again.
export function useAutoRefresh(fn: () => unknown, ms = 5000) {
  const f = useRef(fn)
  f.current = fn
  useEffect(() => {
    const run = () => { if (!document.hidden) f.current() }
    const t = setInterval(run, ms)
    document.addEventListener('visibilitychange', run)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', run) }
  }, [ms])
}
