import { useCallback, useEffect, useState } from 'react'
import { createApi, useSSE } from '../shared/api'
import { Badge, catLabel, fmtDate, fmtTime, guard, QR, RecordCard, RECORD_CATS, useToast, type Rec } from '../shared/ui'

const api = createApi('og_patient')
type Toast = (t: string, e?: boolean) => void
const TABS = ['Home', 'Requests', 'Records', 'Follow-ups', 'Me'] as const
const ICON: Record<string, string> = { Home: '🏠', Requests: '🔔', Records: '📋', 'Follow-ups': '📅', Me: '👤' }

export function App() {
  const [authed, setAuthed] = useState(!!api.token())
  return authed ? <Main /> : <Login onDone={() => setAuthed(true)} />
}

function Login({ onDone }: { onDone: () => void }) {
  const [toastEl, toast] = useToast()
  const [reg, setReg] = useState(false)
  const [f, setF] = useState<Record<string, string>>({ email: 'asha@example.test', password: 'demo1234' })
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = () => guard(toast, async () => {
    const r = await api.call('POST', reg ? '/auth/patient/register' : '/auth/patient/login', f)
    api.setToken(r.token); onDone()
  })
  return (
    <div className="phone">
      {toastEl}
      <h1>🩺 Offgrid</h1>
      <p className="muted">Your medical history. You decide who sees it.</p>
      <div className="card">
        {reg && <>
          <label>First name<input onChange={set('firstName')} /></label>
          <label>Last name<input onChange={set('lastName')} /></label>
          <label>Date of birth<input type="date" onChange={set('dob')} /></label>
          <label>Gender<input onChange={set('gender')} /></label>
          <label>Phone<input onChange={set('phone')} /></label>
        </>}
        <label>Email<input value={f.email} onChange={set('email')} /></label>
        <label>Password<input type="password" value={f.password} onChange={set('password')} /></label>
        <button onClick={submit}>{reg ? 'Create account' : 'Sign in'}</button>{' '}
        <button className="ghost" onClick={() => setReg(!reg)}>{reg ? 'I have an account' : 'Register'}</button>
      </div>
    </div>
  )
}

function Main() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Home')
  const [toastEl, toast] = useToast()
  const [requests, setRequests] = useState<any[]>([])
  const [records, setRecords] = useState<Rec[]>([])
  const [reminders, setReminders] = useState<any[]>([])
  const [emergency, setEmergency] = useState(false)

  const loadReq = useCallback(() => api.call('GET', '/patient/requests').then(setRequests), [])
  const loadRec = useCallback(() => api.call('GET', '/patient/records').then(setRecords), [])
  const loadRem = useCallback(() => api.call('GET', '/patient/reminders').then(setReminders), [])
  useEffect(() => { loadReq(); loadRec(); loadRem() }, [loadReq, loadRec, loadRem])
  useSSE(api, '/patient/events', {
    request: () => { loadReq(); toast('🔔 A hospital is requesting access to your records') },
    records: () => { loadRec() },
    reminders: () => { loadRem(); toast('📅 New follow-up reminder') },
    emergency: () => setEmergency(true),
  })
  const pending = requests.filter(r => r.status === 'PENDING')

  return (
    <div className="phone">
      {toastEl}
      {emergency && <div className="alert" onClick={() => setEmergency(false)}>🚨 A hospital used your emergency card. See Me → Access history.</div>}
      {tab === 'Home' && <Home pending={pending.length} go={setTab} toast={toast} />}
      {tab === 'Requests' && <Requests requests={requests} reload={() => { loadReq() }} toast={toast} />}
      {tab === 'Records' && <Records records={records} reload={loadRec} toast={toast} />}
      {tab === 'Follow-ups' && <Reminders items={reminders} />}
      {tab === 'Me' && <Me toast={toast} />}
      <nav className="tabs">
        {TABS.map(t => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            <span className="ico">{ICON[t]}</span><span>{t}{t === 'Requests' && pending.length > 0 && <span className="dot">{pending.length}</span>}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

function Home({ pending, go, toast }: { pending: number; go: (t: any) => void; toast: Toast }) {
  const [qr, setQr] = useState<{ token: string; expiresAt: string } | null>(null)
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!qr) return
    const t = setInterval(() => { const s = Math.round((+new Date(qr.expiresAt) - Date.now()) / 1000); setLeft(s); if (s <= 0) setQr(null) }, 500)
    return () => clearInterval(t)
  }, [qr])
  return (
    <>
      <h1>My identity</h1>
      <div className="card center">
        {qr ? <>
          <QR text={`offgrid:id:${qr.token}`} />
          <p className="muted">One-time code, valid {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}. It holds no medical data.</p>
          <p className="muted" style={{ wordBreak: 'break-all' }}>{qr.token}</p>
        </> : <div className="help"><b>How it works</b><br />1. Show this QR at the hospital desk.<br />2. They scan it and ask for your records.<br />3. You choose what to share.</div>}
        <button className="bigbtn" onClick={() => guard(toast, async () => setQr(await api.call('POST', '/patient/qr')))}>{qr ? 'New code' : '📱 Show my QR'}</button>
      </div>
      {pending > 0 && <div className="card todo row"><b>🔔 {pending} hospital{pending > 1 ? 's are' : ' is'} waiting for your answer</b><button onClick={() => go('Requests')}>Review</button></div>}
    </>
  )
}

function Requests({ requests, reload, toast }: { requests: any[]; reload: () => void; toast: Toast }) {
  const pending = requests.filter(r => r.status === 'PENDING')
  const rest = requests.filter(r => r.status !== 'PENDING')
  return (
    <>
      <h1>Access requests</h1>
      {pending.length === 0 && <div className="help">✅ Nothing waiting. When a hospital asks for your records, it appears here.</div>}
      {pending.map(r => <Pending key={r.id} r={r} reload={reload} toast={toast} />)}
      {rest.length > 0 && <h2>History</h2>}
      {rest.map(r => (
        <div className="card" key={r.id}>
          <div className="row"><b>{r.requestingHospital.name}</b><Badge kind={r.status}>{r.status}</Badge></div>
          <div className="muted">{fmtTime(r.createdAt)} · {r.categories.map(catLabel).join(', ')}</div>
        </div>
      ))}
    </>
  )
}

function Pending({ r, reload, toast }: { r: any; reload: () => void; toast: Toast }) {
  const [sel, setSel] = useState<string[]>(r.categories)
  const [hours, setHours] = useState(24)
  const toggle = (c: string) => setSel(s => (s.includes(c) ? s.filter(x => x !== c) : [...s, c]))
  const act = (path: string, body?: object) => guard(toast, async () => { await api.call('POST', `/patient/requests/${r.id}/${path}`, body); toast(path === 'approve' ? 'Access granted' : 'Denied'); reload() })
  return (
    <div className="card todo">
      <b style={{ fontSize: '1.15rem' }}>{r.requestingHospital.name}</b>
      {r.sourceHospital ? <div className="muted">wants records held by <b>{r.sourceHospital.name}</b></div> : <div className="muted">wants access to your records</div>}
      <p>“{r.reason}”</p>
      <div>{r.categories.map((c: string) => <label key={c} className="chk"><input type="checkbox" checked={sel.includes(c)} onChange={() => toggle(c)} />{catLabel(c)}</label>)}</div>
      <label>Access lasts
        <select value={hours} onChange={e => setHours(+e.target.value)}>
          <option value={1}>1 hour</option><option value={24}>24 hours</option><option value={168}>7 days</option>
        </select>
      </label>
      <div className="gap">
        <button disabled={!sel.length} onClick={() => act('approve', { categories: sel, hours })}>✓ Approve selected</button>
        <button className="danger" onClick={() => act('deny')}>✕ Deny</button>
      </div>
    </div>
  )
}

function Records({ records, reload, toast }: { records: Rec[]; reload: () => void; toast: Toast }) {
  const [adding, setAdding] = useState(false)
  const open = (id: string) => guard(toast, () => api.openDoc(`/patient/documents/${id}`))
  const verified = records.filter(r => r.status === 'VERIFIED')
  const unverified = records.filter(r => r.status === 'UNVERIFIED')
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    if (!(fd.get('file') as File)?.size) fd.delete('file')
    guard(toast, async () => { await api.call('POST', '/patient/records', fd); setAdding(false); toast('Uploaded as UNVERIFIED'); reload() })
  }
  return (
    <>
      <div className="row"><h1>Medical history</h1><button onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : '+ Upload'}</button></div>
      {adding && (
        <form className="card" onSubmit={submit}>
          <p className="muted">Your uploads stay <b>unverified</b> until a doctor reviews and signs them.</p>
          <label>Type<select name="category">{RECORD_CATS.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}</select></label>
          <label>Title<input name="title" required /></label>
          <label>Date<input name="recordDate" type="date" required /></label>
          <label>Notes<textarea name="notes" /></label>
          <label>File (pdf/png/jpg)<input name="file" type="file" accept="application/pdf,image/png,image/jpeg" /></label>
          <button>Upload</button>
        </form>
      )}
      <h2>✓ Verified ({verified.length})</h2>
      {verified.map(r => <RecordCard key={r.id} r={r} onDoc={open} />)}
      <h2>Unverified ({unverified.length})</h2>
      {unverified.map(r => <RecordCard key={r.id} r={r} onDoc={open} />)}
    </>
  )
}

function Reminders({ items }: { items: any[] }) {
  return (
    <>
      <h1>Follow-ups</h1>
      {items.length === 0 && <p className="muted">No follow-ups.</p>}
      {items.map(r => (
        <div className="card" key={r.id}>
          <div className="row"><b>{r.reason}</b><Badge kind={r.status}>{r.status}</Badge></div>
          <div>📅 {fmtDate(r.followUpDate)} · {r.hospital.name}</div>
          {r.instructions && <p className="muted">{r.instructions}</p>}
        </div>
      ))}
    </>
  )
}

function Me({ toast }: { toast: Toast }) {
  const [me, setMe] = useState<any>(null)
  const [consents, setConsents] = useState<any[]>([])
  const [cards, setCards] = useState<any[]>([])
  const [hist, setHist] = useState<any[]>([])
  const [newCard, setNewCard] = useState<{ code: string; holder: string } | null>(null)
  const load = useCallback(() => {
    api.call('GET', '/patient/me').then(setMe)
    api.call('GET', '/patient/consents').then(setConsents)
    api.call('GET', '/patient/emergency-cards').then(setCards)
    api.call('GET', '/patient/access-history').then(setHist)
  }, [])
  useEffect(load, [load])
  if (!me) return null
  const field = (k: string, label: string) => <label>{label}<input value={me[k] ?? ''} onChange={e => setMe({ ...me, [k]: e.target.value })} /></label>
  const active = consents.filter(c => !c.revokedAt && new Date(c.expiresAt) > new Date())
  return (
    <>
      <h1>{me.firstName} {me.lastName}</h1>
      <div className="card">
        <h3>Personal & emergency info</h3>
        {field('phone', 'Phone')}{field('bloodGroup', 'Blood group')}{field('allergies', 'Severe allergies')}
        {field('chronicConditions', 'Chronic conditions')}{field('emergencyContactName', 'Emergency contact')}{field('emergencyContactPhone', 'Emergency contact phone')}
        <button onClick={() => guard(toast, async () => {
          const { phone, bloodGroup, allergies, chronicConditions, emergencyContactName, emergencyContactPhone } = me
          setMe(await api.call('PATCH', '/patient/me', { phone, bloodGroup, allergies, chronicConditions, emergencyContactName, emergencyContactPhone })); toast('Saved')
        })}>Save</button>
      </div>

      <div className="card">
        <h3>Who can see my data now</h3>
        {active.length === 0 && <p className="muted">No hospital has active access.</p>}
        {active.map(c => (
          <div key={c.id} className="row" style={{ marginBottom: 8 }}>
            <div><b>{c.hospital}</b>{c.sourceHospital && <span className="muted"> (records from {c.sourceHospital})</span>}<div className="muted">{c.categories.map(catLabel).join(', ')} · until {fmtTime(c.expiresAt)}</div></div>
            <button className="danger" onClick={() => guard(toast, async () => { await api.call('POST', `/patient/consents/${c.id}/revoke`); load() })}>Revoke</button>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Emergency access</h3>
        <p className="muted">If you cannot use your phone, a hospital can scan this card or a family member's code. They see blood group, allergies, conditions and your emergency contact for 1 hour. Every use is logged and you are notified.</p>
        {cards.map(c => (
          <div key={c.id} className="row" style={{ marginBottom: 6 }}>
            <span>{c.kind === 'CARD' ? '💳' : '👪'} {c.holderName}</span>
            <button className="ghost" onClick={() => guard(toast, async () => { await api.call('DELETE', `/patient/emergency-cards/${c.id}`); load() })}>Revoke</button>
          </div>
        ))}
        {newCard && <div className="center"><QR text={`offgrid:em:${newCard.code}`} size={180} /><p className="muted">{newCard.holder}: shown once. Print or save it now.</p><p className="muted" style={{ wordBreak: 'break-all' }}>{newCard.code}</p></div>}
        <div className="gap">
          <button onClick={() => guard(toast, async () => { const r = await api.call('POST', '/patient/emergency-cards', { kind: 'CARD', holderName: `${me.firstName} ${me.lastName}` }); setNewCard({ code: r.code, holder: 'My emergency card' }); load() })}>New emergency card</button>
          <button className="ghost" onClick={() => { const n = prompt('Family member name?'); if (n) guard(toast, async () => { const r = await api.call('POST', '/patient/emergency-cards', { kind: 'FAMILY', holderName: n }); setNewCard({ code: r.code, holder: n }); load() }) }}>Add family member</button>
        </div>
      </div>

      <div className="card">
        <h3>Access history</h3>
        <p className="muted">Every access to your data. Hospitals keep only an anonymous reference.</p>
        <table><tbody>
          {hist.map(h => <tr key={h.txId}><td>{fmtTime(h.at)}</td><td>{h.hospital}<br /><span className="muted">{h.action}</span></td></tr>)}
        </tbody></table>
      </div>
      <button className="ghost" onClick={api.logout}>Sign out</button>
    </>
  )
}

