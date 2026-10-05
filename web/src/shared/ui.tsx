import { useEffect, useRef, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { Html5Qrcode } from 'html5-qrcode'
import './style.css'

export const RECORD_CATS = ['SURGERY', 'LAB', 'IMAGING', 'MEDICATION', 'ALLERGY', 'DIAGNOSIS', 'CONSULTATION', 'DISCHARGE', 'OTHER']
export const REQUEST_CATS = ['PROFILE', ...RECORD_CATS]
export const catLabel = (c: string) => (c === 'PROFILE' ? 'Personal info' : c.charAt(0) + c.slice(1).toLowerCase())
export const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
export const fmtTime = (d: string) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

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
  return <canvas ref={ref} />
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
  hospital: { name: string } | null; author: string | null; documents: { id: string; fileName: string }[]
  verification: { doctor: string; hospital: string; verifiedAt: string; signatureValid: boolean } | null
}

export function RecordCard({ r, onDoc, actions }: { r: Rec; onDoc: (id: string) => void; actions?: ReactNode }) {
  const v = r.verification
  return (
    <div className={`card rec ${r.status.toLowerCase()}`}>
      <div className="row">
        <b>{r.title}</b>
        <Badge kind={r.status}>{r.status}</Badge>
      </div>
      <div className="muted">{catLabel(r.category)} · {fmtDate(r.recordDate)}</div>
      {r.notes && <p>{r.notes}</p>}
      <div className="prov">
        Source: {r.source === 'PATIENT_UPLOAD' ? 'Patient upload' : r.hospital?.name}
        {r.author && <> · Created by {r.author}</>}
        {v && <><br />Verified by {v.doctor} ({v.hospital}) · {fmtDate(v.verifiedAt)} · {v.signatureValid ? '✓ signature valid' : '⚠ SIGNATURE INVALID, record changed after signing'}</>}
        {!v && <><br />Not verified by a doctor. Not part of the verified clinical history.</>}
      </div>
      {r.documents.map(d => <button key={d.id} className="link" onClick={() => onDoc(d.id)}>📎 {d.fileName}</button>)}
      {actions}
    </div>
  )
}
