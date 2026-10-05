import { useEffect, useRef, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { Html5Qrcode } from 'html5-qrcode'
import type { Api } from './api'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import '@fontsource/plus-jakarta-sans/800.css'
import '@fontsource/space-mono/400.css'
import '@fontsource/space-mono/700.css'
import '@fontsource/material-symbols-outlined/400.css'
import './style.css'

export const RECORD_CATS = ['SURGERY', 'LAB', 'IMAGING', 'MEDICATION', 'ALLERGY', 'DIAGNOSIS', 'CONSULTATION', 'DISCHARGE', 'OTHER']
export const REQUEST_CATS = ['PROFILE', ...RECORD_CATS]
export const catLabel = (c: string) => (c === 'PROFILE' ? 'Personal info' : c.charAt(0) + c.slice(1).toLowerCase())
export const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
export const fmtTime = (d: string) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export const Icon = ({ n, style }: { n: string; style?: React.CSSProperties }) => <span className="ms" style={style} aria-hidden>{n}</span>
const CAT_ICON: Record<string, string> = { SURGERY: 'medical_services', LAB: 'science', IMAGING: 'radiology', MEDICATION: 'medication', ALLERGY: 'warning', DIAGNOSIS: 'stethoscope', CONSULTATION: 'clinical_notes', DISCHARGE: 'logout', OTHER: 'description' }

export function Badge({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={`badge ${kind.toLowerCase()}`}>{children}</span>
}

export function useToast() {
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null)
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t) } }, [msg])
  return [msg && <div className={`toast ${msg.err ? 'err' : ''}`} onClick={() => setMsg(null)}>{msg.text}</div>, (text: string, err = false) => setMsg({ text, err })] as const
}

// Run an action, toast the error. Keeps handlers short.
export const guard = (toast: (t: string, e?: boolean) => void, fn: () => Promise<unknown>) => fn().catch(e => toast(e.message, true))

export function QR({ text, size = 220 }: { text: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (ref.current) QRCode.toCanvas(ref.current, text, { width: size, margin: 1 }) }, [text, size])
  return <div className="qrbox"><canvas ref={ref} /></div>
}

export function Scanner({ onScan }: { onScan: (text: string) => void }) {
  const done = useRef(false)
  useEffect(() => {
    const s = new Html5Qrcode('qr-reader')
    s.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, t => { if (!done.current) { done.current = true; onScan(t) } }, () => {}).catch(() => {})
    return () => { s.stop().then(() => s.clear()).catch(() => {}) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return <div id="qr-reader" />
}

export type Rec = {
  id: string; category: string; title: string; notes: string | null; recordDate: string; status: 'VERIFIED' | 'UNVERIFIED'; source: string
  hospital: { name: string } | null; author: string | null; documents: { id: string; fileName: string; fileType: string }[]
  verification: { doctor: string; hospital: string; verifiedAt: string; signatureValid: boolean } | null
}

// Circular photo (fetched with the auth header) with an initials fallback. `path` null means no photo.
export function Avatar({ api, path, initials, size = 40, version = 0 }: { api: Api; path: string | null; initials: string; size?: number; version?: number }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (!path) { setUrl(null); return }
    api.blobUrl(path).then(u => { if (live) setUrl(u) }).catch(() => { if (live) setUrl(null) })
    return () => { live = false }
  }, [path, version]) // eslint-disable-line react-hooks/exhaustive-deps
  const box: React.CSSProperties = { width: size, height: size, fontSize: size * 0.4 }
  return url ? <img className="avatar" style={box} src={url} alt="" /> : <div className="avatar" style={box}>{initials}</div>
}

const blobCache = new Map<string, string>()
// Images render inline (fetched with the auth header, so the server still enforces consent). Other files open on click.
function DocPreview({ d, api, base }: { d: Rec['documents'][number]; api: Api; base: string }) {
  const key = base + d.id
  const isImage = d.fileType.startsWith('image/')
  const [url, setUrl] = useState<string | null>(blobCache.get(key) ?? null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!isImage || url) return
    api.blobUrl(key).then(u => { blobCache.set(key, u); setUrl(u) }).catch(() => setFailed(true))
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!isImage || failed) {
    return <button className="link" onClick={() => api.openDoc(key).catch(() => {})}><Icon n="attach_file" style={{ fontSize: 18 }} /> {d.fileName}</button>
  }
  return url
    ? <figure className="docfig"><img className="docimg" src={url} alt={d.fileName} onClick={() => window.open(url, '_blank')} /><figcaption className="mono">{d.fileName} · tap to enlarge</figcaption></figure>
    : <div className="docimg skeleton">Loading photo…</div>
}

export function RecordCard({ r, api, docBase, actions }: { r: Rec; api: Api; docBase: string; actions?: ReactNode }) {
  const v = r.verification
  const bad = v && !v.signatureValid
  return (
    <div className={`card rec ${r.status.toLowerCase()}`}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 12, flexWrap: 'nowrap', alignItems: 'flex-start', minWidth: 0 }}>
          <div className="recicon"><Icon n={CAT_ICON[r.category] ?? 'description'} /></div>
          <div>
            <h3 style={{ margin: 0 }}>{r.title}</h3>
            <div className="muted">{catLabel(r.category)} · {fmtDate(r.recordDate)}</div>
          </div>
        </div>
        {bad ? <Badge kind="invalid"><Icon n="gpp_bad" style={{ fontSize: 14 }} /> SIGNATURE INVALID</Badge>
          : r.status === 'VERIFIED' ? <Badge kind="verified"><Icon n="key" style={{ fontSize: 14 }} /> ED25519 SIGNED</Badge>
          : <Badge kind="unverified"><Icon n="pending" style={{ fontSize: 14 }} /> UNVERIFIED</Badge>}
      </div>
      {r.notes && <p className="notes">{r.notes}</p>}
      <div className="prov">
        Source: <b>{r.source === 'PATIENT_UPLOAD' ? 'Patient upload' : r.hospital?.name}</b>
        {r.author && <> · Created by <b>{r.author}</b></>}
        {v && <><br />Verified by <b>{v.doctor}</b> ({v.hospital}) · {fmtDate(v.verifiedAt)}{bad ? <span className="bad"> · record changed after signing</span> : ' · hash integrity OK'}</>}
        {!v && <><br />Not verified by a doctor. Not part of the verified clinical history.</>}
      </div>
      {r.documents.map(d => <DocPreview key={d.id} d={d} api={api} base={docBase} />)}
      {actions}
    </div>
  )
}
