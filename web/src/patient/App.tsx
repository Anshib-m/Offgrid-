import { useCallback, useEffect, useState } from 'react'
import { createApi, useAutoRefresh, useSSE } from '../shared/api'
import { Avatar, Badge, catLabel, fmtDate, fmtTime, guard, Icon, QR, RecordCard, RECORD_CATS, useToast, type Rec } from '../shared/ui'

const api = createApi('og_patient')
type Toast = (t: string, e?: boolean) => void
const TABS = ['Home', 'Requests', 'Records', 'Follow-ups', 'Me'] as const
type View = (typeof TABS)[number] | 'History'
const ICON: Record<string, string> = { Home: 'qr_code_2', Requests: 'how_to_reg', Records: 'folder_open', 'Follow-ups': 'event', Me: 'person' }

export function App() {
  const [authed, setAuthed] = useState(!!api.token())
  return authed ? <Main /> : <Login onDone={() => setAuthed(true)} />
}

function Login({ onDone }: { onDone: () => void }) {
  const [toastEl, toast] = useToast()
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login')
  const [f, setF] = useState<Record<string, string>>({ email: 'asha@example.test', password: 'demo1234' })
  const [fg, setFg] = useState({ dob: '', newPassword: '', confirm: '' })
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = () => guard(toast, async () => {
    const r = await api.call('POST', mode === 'register' ? '/auth/patient/register' : '/auth/patient/login', f)
    api.setToken(r.token); onDone()
  })
  const reset = () => guard(toast, async () => {
    if (fg.newPassword.length < 8) throw new Error('New password must be at least 8 characters')
    if (fg.newPassword !== fg.confirm) throw new Error('Passwords do not match')
    await api.call('POST', '/auth/patient/reset-password', { email: f.email, dob: fg.dob, newPassword: fg.newPassword })
    setF({ ...f, password: fg.newPassword }); setFg({ dob: '', newPassword: '', confirm: '' }); setMode('login')
    toast('Password changed. Sign in with your new password.')
  })
  return (
    <div className="phone">
      {toastEl}
      <div className="brand" style={{ paddingTop: 30 }}><div className="logo"><Icon n="health_and_safety" /></div><div><b>OFFGRID HEALTH</b><span className="mono">Patient app</span></div></div>
      <p className="muted">Your medical history. You decide who sees it.</p>
      {mode === 'forgot' ? (
        <div className="card">
          <h2>Reset your password</h2>
          <div className="help">Enter your email and the date of birth you registered with. If they match, you can choose a new password.</div>
          <label>Email<input value={f.email} onChange={set('email')} autoComplete="email" /></label>
          <label>Date of birth<input type="date" value={fg.dob} onChange={e => setFg({ ...fg, dob: e.target.value })} /></label>
          <label>New password (8+ characters)<input type="password" value={fg.newPassword} onChange={e => setFg({ ...fg, newPassword: e.target.value })} autoComplete="new-password" /></label>
          <label>Confirm new password<input type="password" value={fg.confirm} onChange={e => setFg({ ...fg, confirm: e.target.value })} autoComplete="new-password" /></label>
          <button className="bigbtn" disabled={!f.email || !fg.dob || !fg.newPassword} onClick={reset}>Change password</button>
          <button className="ghost bigbtn" style={{ marginTop: 10 }} onClick={() => setMode('login')}>Back to sign in</button>
        </div>
      ) : (
        <div className="card">
          {mode === 'register' && <>
            <label>First name<input onChange={set('firstName')} /></label>
            <label>Last name<input onChange={set('lastName')} /></label>
            <label>Date of birth<input type="date" onChange={set('dob')} /></label>
            <label>Gender<select value={f.gender ?? ''} onChange={set('gender')} required><option value="" disabled>Select…</option><option>Male</option><option>Female</option><option>Other</option></select></label>
            <label>Phone<input onChange={set('phone')} /></label>
          </>}
          <label>Email<input value={f.email} onChange={set('email')} /></label>
          <label>Password<input type="password" value={f.password} onChange={set('password')} /></label>
          <button className="bigbtn" onClick={submit}>{mode === 'register' ? 'Create account' : 'Sign in'}</button>
          <div className="gap" style={{ marginTop: 10, justifyContent: 'space-between' }}>
            <button className="ghost" onClick={() => setMode(mode === 'register' ? 'login' : 'register')}>{mode === 'register' ? 'I have an account' : 'Register'}</button>
            {mode === 'login' && <button className="ghost" onClick={() => setMode('forgot')}><Icon n="lock_reset" />Forgot password?</button>}
          </div>
        </div>
      )}
    </div>
  )
}

function Main() {
  const [tab, setTab] = useState<View>('Home')
  const [me, setMe] = useState<any>(null)
  const [photoVer, setPhotoVer] = useState(0)
  const loadMe = useCallback(() => api.call('GET', '/patient/me').then(m => { setMe(m); setPhotoVer(v => v + 1) }).catch(() => {}), [])
  useEffect(() => { loadMe() }, [loadMe])
  const [toastEl, toast] = useToast()
  const [requests, setRequests] = useState<any[]>([])
  const [records, setRecords] = useState<Rec[]>([])
  const [reminders, setReminders] = useState<any[]>([])
  const [emergency, setEmergency] = useState(false)

  const loadReq = useCallback(() => api.call('GET', '/patient/requests').then(setRequests), [])
  const loadRec = useCallback(() => api.call('GET', '/patient/records').then(setRecords), [])
  const loadRem = useCallback(() => api.call('GET', '/patient/reminders').then(setReminders), [])
  // live data: SSE gives instant pushes, polling is the safety net (keeps everything fresh without a manual reload)
  const refreshAll = useCallback(() => { loadReq(); loadRec(); loadRem() }, [loadReq, loadRec, loadRem])
  useEffect(() => { refreshAll() }, [refreshAll])
  useAutoRefresh(refreshAll)
  useSSE(api, '/patient/events', {
    request: () => { loadReq(); toast('🔔 A hospital is requesting access to your records') },
    records: () => { loadRec() },
    reminders: () => { loadRem(); toast('📅 New follow-up reminder') },
    emergency: () => setEmergency(true),
    consents: () => { loadReq(); toast('A hospital ended its access to your records') },
    visit: () => toast('Your visit was updated. Check the Home screen.'),
  })
  const pending = requests.filter(r => r.status === 'PENDING')

  return (
    <div className="phone">
      {toastEl}
      {emergency && <div className="alert" style={{ cursor: 'pointer' }} onClick={() => { setEmergency(false); setTab('History') }}>🚨 A hospital used your emergency card. Tap to view your access history.</div>}
      <header className="apphead">
        <div className="who" role="button" tabIndex={0} title="Open my profile" onClick={() => setTab('Me')} onKeyDown={e => { if (e.key === 'Enter') setTab('Me') }}>
          <Avatar api={api} path={me?.hasPhoto ? '/patient/me/photo' : null} version={photoVer} initials={me ? (me.firstName[0] + me.lastName[0]).toUpperCase() : ''} size={42} />
          <div style={{ minWidth: 0 }}><b>{me ? `${me.firstName} ${me.lastName}` : 'Offgrid'}</b><span className="mono">Patient</span></div>
        </div>
        <button className="signout" onClick={api.logout}><Icon n="logout" />Sign out</button>
      </header>
      {tab === 'Home' && <Home pending={pending.length} reminders={reminders} go={setTab} toast={toast} />}
      {tab === 'History' && <History onBack={() => setTab('Home')} />}
      {tab === 'Requests' && <Requests requests={requests} reload={() => { loadReq() }} toast={toast} />}
      {tab === 'Records' && <Records records={records} reload={loadRec} toast={toast} />}
      {tab === 'Follow-ups' && <Reminders items={reminders} />}
      {tab === 'Me' && <Me toast={toast} onProfile={loadMe} go={setTab} />}
      <nav className="tabs">
        {TABS.map(t => (
          <button key={t} className={tab === t || (t === 'Home' && tab === 'History') ? 'on' : ''} onClick={() => setTab(t)}>
            <Icon n={ICON[t]} style={{ fontSize: 26 }} /><span>{t}{t === 'Requests' && pending.length > 0 && <span className="dot">{pending.length}</span>}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

const PROFILE_FIELDS: [string, string][] = [['phone', 'Phone'], ['bloodGroup', 'Blood group'], ['allergies', 'Allergies'], ['chronicConditions', 'Chronic conditions'], ['emergencyContactName', 'Emergency contact'], ['emergencyContactPhone', 'Emergency contact phone']]
const daysLeft = (d: string) => Math.ceil((+new Date(d) - Date.now()) / 86_400_000)
const ACTION_LABEL: Record<string, string> = {
  PHOTO_READ: 'viewed your profile photo', ACCESS_RELINQUISHED: 'ended its access to your records', PASSWORD_RESET: 'reset your password', RECORD_DELETED: 'deleted a record', DOB_CHANGED: 'changed your date of birth', PATIENT_REGISTERED: 'registered you',
  QR_SCANNED: 'scanned your QR', ACCESS_REQUESTED: 'requested access', CONSENT_GRANTED: 'access approved', CONSENT_DENIED: 'request denied', CONSENT_REVOKED: 'access revoked',
  RECORDS_READ: 'viewed your records', RECORD_CREATED: 'added a record', RECORD_VERIFIED: 'verified a record', DISCHARGED: 'discharged you', FOLLOWUP_CREATED: 'set a follow-up', FOLLOWUP_DELETED: 'removed a follow-up', VISIT_ASSIGNED: 'assigned you to a doctor', VISIT_REASSIGNED: 'changed your doctor', VISIT_CANCELLED: 'cancelled your visit', VISIT_STARTED: 'started your consultation', VISIT_COMPLETED: 'completed your visit', DOCTOR_REVOKED: 'revoked a doctor', DOCTOR_ALLOWED: 'allowed a doctor again', DOCUMENT_READ: 'opened a document',
}
const actionLabel = (a: string) => (a.startsWith('EMERGENCY_ACCESS') ? 'used your emergency card' : ACTION_LABEL[a] ?? a.toLowerCase().replace(/_/g, ' '))

function Home({ pending, reminders, go, toast }: { pending: number; reminders: any[]; go: (t: View) => void; toast: Toast }) {
  const [qr, setQr] = useState<{ token: string; expiresAt: string } | null>(null)
  const [left, setLeft] = useState(0)
  const [me, setMe] = useState<any>(null)
  const [consents, setConsents] = useState<any[]>([])
  const [cards, setCards] = useState<any[] | null>(null)
  const [hist, setHist] = useState<any[]>([])
  const [visits, setVisits] = useState<any[]>([])
  const [doctors, setDoctors] = useState<any[]>([])
  const load = useCallback(() => {
    api.call('GET', '/patient/visits').then(setVisits).catch(() => {})
    api.call('GET', '/patient/doctors').then(setDoctors).catch(() => {})
    api.call('GET', '/patient/me').then(setMe).catch(() => {})
    api.call('GET', '/patient/consents').then(setConsents).catch(() => {})
    api.call('GET', '/patient/emergency-cards').then(setCards).catch(() => {})
    api.call('GET', '/patient/access-history').then(h => setHist(h.slice(0, 3))).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])
  useAutoRefresh(load, 10_000)
  useEffect(() => {
    if (!qr) return
    const t = setInterval(() => { const sec = Math.round((+new Date(qr.expiresAt) - Date.now()) / 1000); setLeft(sec); if (sec <= 0) setQr(null) }, 500)
    return () => clearInterval(t)
  }, [qr])

  const revokeDoctor = (d: { id: string; name: string }) => {
    if (!confirm(`Revoke ${d.name}? They lose access to your records and any visit with them is cancelled. Other staff at that hospital keep the access you gave.`)) return
    guard(toast, async () => { await api.call('POST', `/patient/doctors/${d.id}/revoke`); toast(`${d.name} revoked`); load() })
  }
  const allowDoctor = (d: { id: string; name: string }) => guard(toast, async () => { await api.call('POST', `/patient/doctors/${d.id}/allow`); toast(`${d.name} allowed again`); load() })
  const active = consents.filter(c => !c.revokedAt && new Date(c.expiresAt) > new Date())
  const next = reminders.filter(r => r.status === 'UPCOMING').sort((a, b) => +new Date(a.followUpDate) - +new Date(b.followUpDate))[0]
  const missing = me ? PROFILE_FIELDS.filter(([k]) => !me[k]) : []
  const pct = me ? Math.round(((PROFILE_FIELDS.length - missing.length) / PROFILE_FIELDS.length) * 100) : 0
  const emergencyMissing = missing.filter(([k]) => ['bloodGroup', 'allergies', 'emergencyContactName', 'emergencyContactPhone'].includes(k))

  return (
    <>
      <div className="row"><h1>{me ? `Hi, ${me.firstName}` : 'Welcome'}</h1><span className="pill"><span className="dot" />Private</span></div>

      {pending > 0 && <div className="card todo row"><b>{pending} hospital{pending > 1 ? 's are' : ' is'} waiting for your answer</b><button onClick={() => go('Requests')}>Review</button></div>}

      {visits.filter(v => v.status === 'WAITING' || v.status === 'IN_CONSULT').map(v => (
        <div key={v.id} className="card todo">
          <div className="row"><h3 style={{ margin: 0 }}><Icon n="assignment_ind" style={{ color: 'var(--primary)' }} /> Your visit</h3><Badge kind={v.status}>{v.status === 'WAITING' ? 'WAITING' : 'IN CONSULTATION'}</Badge></div>
          <p style={{ margin: '8px 0 2px' }}><b>{v.doctor.name}</b>{v.doctor.specialty ? ` · ${v.doctor.specialty}` : ''}</p>
          <div className="muted">{v.hospital} · {v.reason}</div>
          {v.status === 'WAITING'
            ? <div className="help" style={{ marginTop: 10, marginBottom: 0 }}>Go to the doctor and show your QR when you arrive. The doctor scans it to start your consultation.</div>
            : <div className="mono" style={{ marginTop: 8 }}>Started {fmtTime(v.arrivedAt)}</div>}
          <button className="danger" style={{ marginTop: 12 }} onClick={() => revokeDoctor({ id: v.doctor.id, name: v.doctor.name })}><Icon n="person_off" />Revoke this doctor</button>
        </div>
      ))}

      <div className="card center">
        {qr ? <>
          <QR text={`offgrid:id:${qr.token}`} />
          <div className="bar" style={{ margin: '12px 0 6px' }}><i style={{ width: `${Math.max(0, Math.min(100, (left / 300) * 100))}%` }} /></div>
          <p className="muted">One-time code, valid {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}. It holds no medical data.</p>
        </> : <div className="help"><b>How it works</b><br />1. Show this QR at the hospital desk.<br />2. They scan it and ask for your records.<br />3. You choose what to share, and for how long.</div>}
        <button className="bigbtn" onClick={() => guard(toast, async () => setQr(await api.call('POST', '/patient/qr')))}><Icon n="qr_code_2" />{qr ? 'New code' : 'Show my QR'}</button>
      </div>

      <div className="card">
        <div className="row"><h3 style={{ margin: 0 }}><Icon n="event" style={{ color: 'var(--secondary)' }} /> Next follow-up</h3>{next && <button className="ghost" style={{ minHeight: 36 }} onClick={() => go('Follow-ups')}>All</button>}</div>
        {next ? (
          <div style={{ marginTop: 10 }}>
            <div className="row"><b>{next.reason}</b><Badge kind={daysLeft(next.followUpDate) <= 3 ? 'pending' : 'upcoming'}>{daysLeft(next.followUpDate) <= 0 ? 'TODAY' : `IN ${daysLeft(next.followUpDate)} DAYS`}</Badge></div>
            <div className="muted">{fmtDate(next.followUpDate)} · {next.hospital.name}</div>
            {next.instructions && <div className="help" style={{ marginTop: 10, marginBottom: 0 }}>{next.instructions}</div>}
          </div>
        ) : <p className="muted">No follow-ups planned. Hospitals will add one when you are discharged.</p>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}><Icon n="visibility" style={{ color: 'var(--secondary)' }} /> Who can see my data</h3>
        {active.length === 0 && <p className="muted">No hospital has access right now.</p>}
        {active.map(c => (
          <div key={c.id} className="row" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <b>{c.hospital}</b>{c.sourceHospital && <span className="muted"> (records from {c.sourceHospital})</span>}
              <div className="muted">{c.categories.map(catLabel).join(', ')}</div>
              <div className="mono" style={{ marginTop: 2 }}>until {fmtTime(c.expiresAt)}</div>
            </div>
            <button className="danger" style={{ minHeight: 40 }} onClick={() => guard(toast, async () => { await api.call('POST', `/patient/consents/${c.id}/revoke`); toast('Access revoked'); load() })}>Revoke</button>
          </div>
        ))}
      </div>

      {doctors.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}><Icon n="stethoscope" style={{ color: 'var(--secondary)' }} /> My doctors</h3>
          <p className="muted">Doctors you were sent to. Revoking one cuts off only that doctor. The hospital's other staff keep what you approved.</p>
          {doctors.map(d => (
            <div key={d.id} className="row" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <b>{d.name}</b>{d.specialty && <span className="muted"> · {d.specialty}</span>}
                <div className="muted">{d.hospital}</div>
                <div style={{ marginTop: 4 }}><Badge kind={d.revoked ? 'revoked' : 'approved'}>{d.revoked ? 'REVOKED' : d.activeVisit ? 'ASSIGNED' : 'ALLOWED'}</Badge></div>
              </div>
              {d.revoked
                ? <button className="ghost" style={{ minHeight: 40 }} onClick={() => allowDoctor(d)}>Allow again</button>
                : <button className="danger" style={{ minHeight: 40 }} onClick={() => revokeDoctor(d)}>Revoke doctor</button>}
            </div>
          ))}
        </div>
      )}

      {me && (
        <div className="card">
          <div className="row" style={{ flexWrap: 'nowrap', gap: 16 }}>
            <div className="ring" style={{ ['--pct' as string]: `${pct}%` }}><span>{pct}%</span></div>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0 }}>Profile {pct === 100 ? 'complete' : 'incomplete'}</h3>
              <div className="muted">{pct === 100 ? 'Hospitals and emergency staff get accurate details.' : `Missing: ${missing.map(([, l]) => l).join(', ')}`}</div>
            </div>
          </div>
          {pct < 100 && <button className="ghost" style={{ marginTop: 12 }} onClick={() => go('Me')}>Complete profile</button>}
        </div>
      )}

      {cards && (
        <div className={`card ${cards.length === 0 || emergencyMissing.length ? 'todo' : ''}`}>
          <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ margin: 0 }}><Icon n="emergency" style={{ color: 'var(--rose)' }} /> Emergency card</h3>
              <div className="muted">
                {cards.length === 0 ? 'No card yet. Create one so doctors can help you if you cannot use your phone.'
                  : emergencyMissing.length ? `Card active, but missing: ${emergencyMissing.map(([, l]) => l).join(', ')}.`
                  : `${cards.length} card${cards.length > 1 ? 's' : ''} active. Doctors see only blood group, allergies, conditions and your emergency contact.`}
              </div>
            </div>
            <button className="ghost" onClick={() => go('Me')}>{cards.length === 0 ? 'Create' : 'Manage'}</button>
          </div>
        </div>
      )}

      <div className="card clickcard" role="button" tabIndex={0} onClick={() => go('History')} onKeyDown={e => { if (e.key === 'Enter') go('History') }}>
        <div className="row"><h3 style={{ margin: 0 }}><Icon n="history" style={{ color: 'var(--secondary)' }} /> Recent activity</h3><span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>View all <Icon n="chevron_right" /></span></div>
        {hist.length === 0 && <p className="muted">Nothing yet.</p>}
        {hist.map(h => (
          <div key={h.txId} style={{ marginTop: 10 }}>
            <div><b>{h.action.startsWith('DOCTOR_') ? 'You' : h.hospital}</b> {actionLabel(h.action)}{h.action.startsWith('DOCTOR_') && h.hospital ? ` at ${h.hospital}` : ''}</div>
            <div className="mono">{fmtTime(h.at)}</div>
          </div>
        ))}
      </div>
    </>
  )
}

function Requests({ requests, reload, toast }: { requests: any[]; reload: () => void; toast: Toast }) {
  const pending = requests.filter(r => r.status === 'PENDING')
  const rest = requests.filter(r => r.status !== 'PENDING')
  return (
    <>
      <h1>Access requests</h1>
      {pending.length === 0 && <div className="help">Nothing waiting. When a hospital asks for your records, it appears here.</div>}
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
        <button disabled={!sel.length} onClick={() => act('approve', { categories: sel, hours })}>Approve selected</button>
        <button className="danger" onClick={() => act('deny')}>Deny</button>
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
      <h2><Icon n="verified" style={{ color: 'var(--ok)' }} /> Verified ({verified.length})</h2>
      {verified.map(r => <RecordCard key={r.id} r={r} api={api} docBase="/patient/documents/" />)}
      <h2>Unverified ({unverified.length})</h2>
      {unverified.map(r => (
        <RecordCard key={r.id} r={r} api={api} docBase="/patient/documents/" actions={r.source === 'PATIENT_UPLOAD' && (
          <button className="danger" onClick={() => { if (confirm(`Delete "${r.title}"? This cannot be undone.`)) guard(toast, async () => { await api.call('DELETE', `/patient/records/${r.id}`); toast('Record deleted'); reload() }) }}><Icon n="delete" />Delete my upload</button>
        )} />
      ))}
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

function History({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<any[] | null>(null)
  const load = useCallback(() => api.call('GET', '/patient/access-history').then(setItems).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  useAutoRefresh(load)
  return (
    <>
      <button className="ghost" onClick={onBack}><Icon n="arrow_back" />Back</button>
      <h1 style={{ marginTop: 14 }}>Access history</h1>
      <p className="muted">Everyone who scanned, requested or viewed your data. Hospitals keep only an anonymous reference to you.</p>
      {!items && <p className="muted">Loading…</p>}
      {items && items.length === 0 && <div className="help">No activity yet.</div>}
      {items && (
        <div className="card">
          {items.map(h => {
            const emergency = h.action.startsWith('EMERGENCY_ACCESS')
            return (
              <div key={h.txId} className="histrow">
                <div className={`recicon ${emergency ? 'warn' : ''}`}><Icon n={emergency ? 'emergency' : h.action.startsWith('CONSENT') ? 'verified_user' : h.action.startsWith('RECORD') || h.action === 'DOCUMENT_READ' ? 'description' : 'visibility'} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div><b>{h.action.startsWith('DOCTOR_') ? 'You' : h.hospital ?? 'You'}</b> {actionLabel(h.action)}{h.action.startsWith('DOCTOR_') && h.hospital ? ` at ${h.hospital}` : ''}</div>
                  {h.purpose && <div className="muted">{h.purpose}</div>}
                  <div className="mono">{fmtTime(h.at)} · tx {h.txId.slice(0, 8)}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function Me({ toast, onProfile, go }: { toast: Toast; onProfile: () => void; go: (t: View) => void }) {
  const [ver, setVer] = useState(0)
  const [origDob, setOrigDob] = useState('')
  const [curPw, setCurPw] = useState('')
  const [me, setMe] = useState<any>(null)
  const [consents, setConsents] = useState<any[]>([])
  const [cards, setCards] = useState<any[]>([])
  const [newCard, setNewCard] = useState<{ code: string; holder: string } | null>(null)
  const load = useCallback(() => {
    api.call('GET', '/patient/me').then(m => { setMe(m); setOrigDob(m.dob.slice(0, 10)) })
    api.call('GET', '/patient/consents').then(setConsents)
    api.call('GET', '/patient/emergency-cards').then(setCards)
  }, [])
  useEffect(load, [load])
  if (!me) return null
  const field = (k: string, label: string) => <label>{label}<input value={me[k] ?? ''} onChange={e => setMe({ ...me, [k]: e.target.value })} /></label>
  const active = consents.filter(c => !c.revokedAt && new Date(c.expiresAt) > new Date())
  return (
    <>
      <h1>{me.firstName} {me.lastName}</h1>
      <div className="card">
        <h3>Profile photo</h3>
        <div className="photobox">
          <Avatar api={api} path={me.hasPhoto ? '/patient/me/photo' : null} version={ver} initials={(me.firstName[0] + me.lastName[0]).toUpperCase()} size={96} />
          <div className="stack" style={{ flex: 1, minWidth: 180 }}>
            <label className="chk" style={{ cursor: 'pointer', margin: 0, background: 'var(--primary)', color: 'var(--on-primary)', borderColor: 'var(--primary)', fontWeight: 700 }}>
              <Icon n="photo_camera" style={{ marginRight: 8 }} />{me.hasPhoto ? 'Change photo' : 'Add a photo'}
              <input type="file" accept="image/png,image/jpeg" hidden onChange={e => {
                const file = e.target.files?.[0]; e.target.value = ''
                if (!file) return
                const fd = new FormData(); fd.append('file', file)
                guard(toast, async () => { setMe(await api.call('POST', '/patient/me/photo', fd)); setVer(v => v + 1); onProfile(); toast('Profile photo updated') })
              }} />
            </label>
            {me.hasPhoto && <button className="ghost" onClick={() => guard(toast, async () => { setMe(await api.call('DELETE', '/patient/me/photo')); setVer(v => v + 1); onProfile(); toast('Photo removed') })}><Icon n="delete" />Remove photo</button>}
            <div className="muted">Shown on your profile. Hospitals see it only if you share your personal info with them.</div>
          </div>
        </div>
      </div>
      <div className="card">
        <h3>Personal & emergency info</h3>
        {field('firstName', 'First name')}{field('lastName', 'Last name')}
        <label>Date of birth<input type="date" max={new Date().toISOString().slice(0, 10)} value={me.dob.slice(0, 10)} onChange={e => setMe({ ...me, dob: e.target.value })} /></label>
        {me.dob.slice(0, 10) !== origDob && (
          <div className="help">
            Your date of birth also lets you reset your password, so confirm it is you.
            <label style={{ marginTop: 8 }}>Current password<input type="password" value={curPw} onChange={e => setCurPw(e.target.value)} autoComplete="current-password" /></label>
          </div>
        )}
        {field('phone', 'Phone')}{field('bloodGroup', 'Blood group')}{field('allergies', 'Severe allergies')}
        {field('chronicConditions', 'Chronic conditions')}{field('emergencyContactName', 'Emergency contact')}{field('emergencyContactPhone', 'Emergency contact phone')}
        <button onClick={() => guard(toast, async () => {
          const { firstName, lastName, dob, phone, bloodGroup, allergies, chronicConditions, emergencyContactName, emergencyContactPhone } = me
          if (!firstName?.trim() || !lastName?.trim()) throw new Error('First and last name are required')
          if (!dob) throw new Error('Enter your date of birth')
          const dobChanged = dob.slice(0, 10) !== origDob
          if (dobChanged && !curPw) throw new Error('Enter your current password to change your date of birth')
          const saved = await api.call('PATCH', '/patient/me', { firstName, lastName, dob: dob.slice(0, 10), ...(dobChanged ? { currentPassword: curPw } : {}), phone, bloodGroup, allergies, chronicConditions, emergencyContactName, emergencyContactPhone })
          setMe(saved); setOrigDob(saved.dob.slice(0, 10)); setCurPw(''); onProfile(); toast('Saved')
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

      <div className="card clickcard" role="button" tabIndex={0} onClick={() => go('History')} onKeyDown={e => { if (e.key === 'Enter') go('History') }}>
        <div className="row"><h3 style={{ margin: 0 }}><Icon n="history" style={{ color: 'var(--secondary)' }} /> Access history</h3><span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>View <Icon n="chevron_right" /></span></div>
        <p className="muted" style={{ margin: '6px 0 0' }}>See every hospital that scanned, requested or viewed your data.</p>
      </div>
      <button className="signout bigbtn" onClick={api.logout}><Icon n="logout" />Sign out</button>
    </>
  )
}

