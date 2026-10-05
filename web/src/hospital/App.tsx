import { useCallback, useEffect, useState } from 'react'
import { createApi, useAutoRefresh, useSSE } from '../shared/api'
import { Avatar, Badge, catLabel, fmtDate, fmtTime, guard, Icon, RecordCard, RECORD_CATS, REQUEST_CATS, Scanner, useToast, type Rec } from '../shared/ui'

const api = createApi('og_staff')
type Toast = (t: string, e?: boolean) => void
type Me = { id: string; fullName: string; role: 'DOCTOR' | 'STAFF'; specialty: string | null; hospital: { id: string; name: string } }
type Patient = { scanId: string; patientId: string; name: string; age?: number }
const stripPrefix = (s: string) => s.trim().replace(/^offgrid:(id|em):/, '')

export function App() {
  const [authed, setAuthed] = useState(!!api.token())
  return authed ? <Shell /> : <Login onDone={() => setAuthed(true)} />
}

function Login({ onDone }: { onDone: () => void }) {
  const [toastEl, toast] = useToast()
  const [f, setF] = useState({ email: 'desk@citygeneral.test', password: 'demo1234' })
  return (
    <div style={{ maxWidth: 440, margin: '10vh auto', padding: 16 }}>
      {toastEl}
      <div className="brand"><div className="logo"><Icon n="health_and_safety" /></div><div><b>OFFGRID HEALTH</b><span className="mono">Hospital portal</span></div></div>
      <div className="card">
        <h2>Staff sign in</h2>
        <label>Staff email<input value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></label>
        <label>Password<input type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></label>
        <button className="bigbtn" onClick={() => guard(toast, async () => { api.setToken((await api.call('POST', '/auth/staff/login', f)).token); onDone() })}>Sign in</button>
      </div>
      <p className="muted">Demo: desk@ or dr.rao@citygeneral.test · desk@ or dr.mehta@riverside.test · password demo1234</p>
    </div>
  )
}


const NAV = [
  { id: 'Patient desk', label: 'Patient Desk & Scan', icon: 'qr_code_scanner' },
  { id: 'Active patients', label: 'Active Patients', icon: 'groups' },
  { id: 'Requests', label: 'Access Requests', icon: 'verified_user' },
  { id: 'Emergency', label: 'Emergency Access', icon: 'local_hospital', warn: true },
  { id: 'Audit log', label: 'Audit Trail', icon: 'receipt_long' },
] as const
type Page = (typeof NAV)[number]['id']

function Shell() {
  const [me, setMe] = useState<Me | null>(null)
  const [page, setPage] = useState<Page>('Patient desk')
  const [tick, setTick] = useState(0)
  const [toastEl, toast] = useToast()
  // several patients can be open at once, shown as tabs on the desk
  const [ws, setWs] = useState<{ open: Patient[]; activeId: string | null }>(() => { try { return JSON.parse(sessionStorage.getItem('og_open') ?? '') } catch { return { open: [], activeId: null } } })
  const save = (n: { open: Patient[]; activeId: string | null }) => { setWs(n); sessionStorage.setItem('og_open', JSON.stringify(n)) }
  const openPatients = (ps: Patient[]) => {
    let open = [...ws.open]
    for (const p of ps) {
      const i = open.findIndex(x => x.patientId === p.patientId)
      if (i < 0) open.push(p)
      else open[i] = { ...open[i], ...p, scanId: p.scanId || open[i].scanId } // keep the freshest scan
    }
    save({ open, activeId: ps[ps.length - 1].patientId })
    setPage('Patient desk')
  }
  const closePatient = (id: string) => {
    const open = ws.open.filter(x => x.patientId !== id)
    save({ open, activeId: ws.activeId === id ? open[open.length - 1]?.patientId ?? null : ws.activeId })
  }
  useEffect(() => { api.call('GET', '/hospital/me').then(setMe) }, [])
  useSSE(api, '/hospital/events', { 'request-updated': () => { setTick(t => t + 1); toast('Patient responded to an access request') } })
  if (!me) return null
  const initials = me.fullName.split(' ').filter(w => !w.endsWith('.') && /^\p{L}/u.test(w)).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className="shell">
      {toastEl}
      <aside className="side">
        <div className="brand"><div className="logo"><Icon n="health_and_safety" /></div><div><b>OFFGRID HEALTH</b><span className="mono">{me.hospital.name}</span></div></div>
        <nav>
          {NAV.map(n => (
            <button key={n.id} className={`${page === n.id ? 'on' : ''} ${'warn' in n ? 'warn' : ''}`} onClick={() => setPage(n.id)}><Icon n={n.icon} />{n.label}</button>
          ))}
        </nav>
        <div style={{ marginTop: 'auto' }}>
          <button className="ghost" style={{ width: '100%' }} onClick={api.logout}><Icon n="logout" />Sign out</button>
        </div>
      </aside>
      <div>
        <header className="top">
          <span className="pill"><span className="dot" />{me.role === 'DOCTOR' ? 'Signing key ready' : 'Reception session'}</span>
          <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
            <div style={{ textAlign: 'right' }}><b>{me.fullName}</b><div className="mono">{me.role === 'DOCTOR' ? me.specialty ?? 'Doctor' : 'Reception'}</div></div>
            <div className="avatar">{initials}</div>
            <button className="signout" onClick={api.logout}><Icon n="logout" />Sign out</button>
          </div>
        </header>
        <main className="main">
          {page === 'Patient desk' && <Desk me={me} open={ws.open} activeId={ws.activeId} setActive={id => save({ ...ws, activeId: id })} add={p => openPatients([p])} close={closePatient} tick={tick} toast={toast} />}
          {page === 'Active patients' && <ActivePatients open={ws.open} onOpen={openPatients} tick={tick} toast={toast} />}
          {page === 'Requests' && <Requests tick={tick} />}
          {page === 'Emergency' && <Emergency toast={toast} />}
          {page === 'Audit log' && <Audit />}
        </main>
      </div>
    </div>
  )
}

// ---------- desk: scan or register, then work on the patient
function Desk({ me, open, activeId, setActive, add, close, tick, toast }: { me: Me; open: Patient[]; activeId: string | null; setActive: (id: string) => void; add: (p: Patient) => void; close: (id: string) => void; tick: number; toast: Toast }) {
  const patient = open.find(p => p.patientId === activeId) ?? null
  const [scanning, setScanning] = useState(false)
  const [token, setToken] = useState('')
  const [reg, setReg] = useState(false)
  const [created, setCreated] = useState<{ email: string; pw: string } | null>(null)
  const [adding, setAdding] = useState(false) // the '+ Identify another patient' panel
  const scan = (t: string) => guard(toast, async () => {
    const s = await api.call('POST', '/hospital/scan', { token: stripPrefix(t) })
    add(s); setScanning(false); setAdding(false); setToken(''); toast(`Identified ${s.name}, ${s.age}. Request access to see records.`)
  })
  const register = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    guard(toast, async () => {
      const r = await api.call('POST', '/hospital/patients', f)
      add({ scanId: r.scanId, patientId: r.patientId, name: `${f.firstName} ${f.lastName}` })
      setCreated({ email: f.email, pw: r.tempPassword }); setReg(false); setAdding(false)
    })
  }
  const panels = (
    <div className="cols">
      <div className="panel">
        <div className="row"><h3 style={{ margin: 0 }}><Icon n="qr_code_scanner" style={{ color: 'var(--secondary)' }} /> {open.length ? 'Identify another patient' : 'Identify the patient'}</h3><span className="mono">one-time code · 5 min</span></div>
        <p className="muted">The QR holds no medical data. Scan it or paste the code from the patient app.</p>
        {scanning ? <><Scanner onScan={scan} /><button className="ghost" onClick={() => setScanning(false)}>Stop camera</button></> : <button className="ghost" onClick={() => setScanning(true)}><Icon n="photo_camera" />Open camera</button>}
        <label style={{ marginTop: 14 }}>Code<input value={token} onChange={e => setToken(e.target.value)} placeholder="offgrid:id:…" /></label>
        <button disabled={!token} onClick={() => scan(token)}>Identify patient</button>
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}><Icon n="person_add" style={{ color: 'var(--secondary)' }} /> Register a new patient</h3>
        {!reg ? <button className="ghost" onClick={() => setReg(true)}>Register walk-in patient</button> : (
          <form onSubmit={register}>
            <div className="cols" style={{ gap: 10 }}>
              <label>First name<input name="firstName" required /></label><label>Last name<input name="lastName" required /></label>
              <label>Email<input name="email" type="email" required /></label><label>Phone<input name="phone" required /></label>
              <label>Date of birth<input name="dob" type="date" required /></label><label>Gender<select name="gender" required defaultValue=""><option value="" disabled>Select…</option><option>Male</option><option>Female</option><option>Other</option></select></label>
            </div>
            <button>Register</button>
          </form>
        )}
      </div>
    </div>
  )
  return (
    <>
      {open.length > 0 && (
        <div className="ptabsrow">
          <div className="ptabs" role="tablist" aria-label="Open patients">
          {open.map(p => (
            <div key={p.patientId} className={`ptab ${p.patientId === activeId ? 'on' : ''}`}>
              <button role="tab" aria-selected={p.patientId === activeId} onClick={() => setActive(p.patientId)}><span className="dotinit">{p.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}</span>{p.name}</button>
              <button className="x" aria-label={`Close ${p.name}`} onClick={() => close(p.patientId)}><Icon n="close" style={{ fontSize: 18 }} /></button>
            </div>
          ))}
          </div>
          <button className="addtab" aria-expanded={adding} onClick={() => setAdding(a => !a)}>
            <Icon n={adding ? 'close' : 'add'} /><Icon n="qr_code_scanner" style={{ color: 'var(--secondary)' }} />Identify another patient
          </button>
        </div>
      )}
      {open.length > 0 && adding && panels}
      {patient && <Workspace key={patient.patientId} me={me} patient={patient} tick={tick} toast={toast} close={() => close(patient.patientId)} />}
      {created && <div className="alert" style={{ background: 'rgba(16,185,129,.12)', borderColor: 'var(--ok)', color: 'var(--text)' }}>Account created for {created.email}. One-time password: <b className="mono" style={{ fontSize: '1rem', textTransform: 'none' }}>{created.pw}</b>. Give it to the patient now.</div>}
      {open.length === 0 && <><div className="help">Start here: scan the patient's QR (or paste the code), or register a walk-in. Then request access to their records.</div>{panels}</>}
    </>
  )
}

function Workspace({ me, patient, tick, toast, close }: { me: Me; patient: Patient; tick: number; toast: Toast; close: () => void }) {
  const tabs = ['Records', 'Access', 'Add record', ...(me.role === 'DOCTOR' ? ['Discharge'] : []), 'Follow-ups']
  const [tab, setTab] = useState('Records')
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  const [audit, setAudit] = useState<any[]>([])
  const [now, setNow] = useState(Date.now())
  const load = useCallback(() => {
    api.call('GET', `/hospital/patients/${patient.patientId}/records`).then(d => { setData(d); setErr('') }).catch(e => { setData(null); setErr(e.message) })
    api.call('GET', '/hospital/audit').then(a => setAudit(a.slice(0, 5)))
  }, [patient.patientId])
  useEffect(() => { load() }, [load, tick, tab])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  // auto refresh: patient approvals, revokes, new uploads show up without a reload
  useAutoRefresh(load)

  const consents: any[] = data?.consents ?? []
  const expires = consents.length ? Math.max(...consents.map(c => +new Date(c.expiresAt))) : 0
  const left = Math.max(0, Math.floor((expires - now) / 1000))
  const scope = [...new Set(consents.flatMap(c => c.categories as string[]))]
  const verified = data?.verified ?? [], unverified = data?.unverified ?? []
  const invalid = verified.filter((r: Rec) => r.verification && !r.verification.signatureValid).length
  const fmtLeft = `${Math.floor(left / 3600) ? Math.floor(left / 3600) + 'h ' : ''}${Math.floor((left % 3600) / 60)}m ${String(left % 60).padStart(2, '0')}s`
  const sourced = consents.some(c => c.sourceHospitalId)

  return (
    <>
      <div className="banner">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 16, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
           <Avatar api={api} size={72} path={data?.profile?.hasPhoto ? `/hospital/patients/${patient.patientId}/photo` : null} initials={patient.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()} />
           <div>
            <span className="pill" style={{ marginBottom: 8 }}><span className="dot" />{data ? 'Active consent' : 'Awaiting consent'}</span>
            <h1 style={{ margin: '4px 0' }}>{patient.name}</h1>
            <div className="muted">{patient.age != null ? `Age ${patient.age} · ` : ''}Identified by one-time code</div>
            <div className="muted" style={{ marginTop: 6 }}>
              <Icon n="verified_user" style={{ fontSize: 18, color: 'var(--primary)' }} />{' '}
              {data ? <>Access until <b style={{ color: 'var(--text)' }}>{fmtTime(new Date(expires).toISOString())}</b> · Scope: {scope.map(catLabel).join(', ')}</> : 'No active consent. Request access to view records.'}
            </div>
           </div>
          </div>
          <div className="gap">
            <button className="ghost" onClick={() => setTab('Access')}><Icon n="tune" style={{ color: 'var(--secondary)' }} />Request Scope</button>
            {me.role === 'DOCTOR' && <button onClick={() => setTab('Discharge')}><Icon n="draw" />Discharge &amp; Sign</button>}
            {data && <button className="danger" onClick={() => {
              if (!confirm(`End your access to ${patient.name}'s records? You will need the patient's approval to see them again.`)) return
              guard(toast, async () => { await api.call('POST', `/hospital/patients/${patient.patientId}/revoke`); toast('Access ended'); load() })
            }}><Icon n="block" />Revoke access</button>}
            <button className="ghost" onClick={close} title="Close patient"><Icon n="close" /></button>
          </div>
        </div>
      </div>

      <div className="metrics">
        <div className="metric">
          <div className="row"><span className="label">Consent</span><Badge kind={data ? 'approved' : 'pending'}>{data ? 'ACTIVE' : 'NONE'}</Badge></div>
          <div className="big">{data ? fmtLeft : '—'}</div>
          <div className="bar"><i style={{ width: data ? `${Math.min(100, (left / 86400) * 100)}%` : '0%' }} /></div>
        </div>
        <div className="metric">
          <div className="row"><span className="label">Signatures</span><Icon n="verified" style={{ color: 'var(--primary)' }} /></div>
          <div className="big" style={{ color: 'var(--ok)' }}>{verified.length - invalid} valid</div>
          <div className="mono" style={{ color: unverified.length ? 'var(--amber)' : undefined, marginTop: 4 }}>{unverified.length} unverified{invalid ? ` · ${invalid} invalid` : ''}</div>
        </div>
        <div className="metric">
          <div className="row"><span className="label">Record source</span><Icon n="domain" style={{ color: 'var(--secondary)' }} /></div>
          <div className="big" style={{ fontSize: '1.1rem' }}>{!data ? '—' : sourced ? 'Single hospital' : 'Patient history'}</div>
          <div className="mono" style={{ marginTop: 4 }}>{sourced ? 'Limited to the hospital the patient approved' : 'Limited to approved categories'}</div>
        </div>
        <div className="metric">
          <div className="row"><span className="label">Last audit tx</span><Icon n="receipt_long" style={{ color: 'var(--secondary)' }} /></div>
          <div className="big mono" style={{ fontSize: '1.05rem', textTransform: 'none' }}>#{audit[0]?.txId.slice(0, 8) ?? '—'}</div>
          <div className="mono" style={{ marginTop: 4 }}>Append-only, pseudonymous</div>
        </div>
      </div>

      <div className="work">
        <div>
          <div className="subtabs">{tabs.map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
          {tab === 'Access' && <Access patient={patient} tick={tick} toast={toast} />}
          {tab === 'Records' && <Records me={me} data={data} err={err} reload={load} toast={toast} goAccess={() => setTab('Access')} />}
          {tab === 'Add record' && <AddRecord patient={patient} toast={toast} />}
          {tab === 'Discharge' && <Discharge patient={patient} toast={toast} />}
          {tab === 'Follow-ups' && <FollowUps patient={patient} toast={toast} />}
        </div>
        <div className="panel">
          <div className="row"><h3 style={{ margin: 0 }}><Icon n="sensors" style={{ color: 'var(--primary)' }} /> Recent activity</h3><span className="pill" style={{ padding: '2px 8px' }}><span className="dot" /></span></div>
          <p className="muted">Hospital audit trail. Patients appear only as an anonymous reference.</p>
          <div className="audit">
            {audit.map(a => (
              <div key={a.txId}>
                <div className="row"><span className="a">{a.action}</span><span className="mono">{fmtTime(a.at)}</span></div>
                <div className="muted">{a.purpose}</div>
                <div className="mono" style={{ textTransform: 'none' }}>tx {a.txId.slice(0, 8)} · ref {a.patientRef.slice(0, 6)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function Access({ patient, tick, toast }: { patient: Patient; tick: number; toast: Toast }) {
  const [sel, setSel] = useState<string[]>(['PROFILE'])
  const [hospitals, setHospitals] = useState<{ id: string; name: string }[]>([])
  const [source, setSource] = useState('')
  const [reason, setReason] = useState('')
  const [reqs, setReqs] = useState<any[]>([])
  const load = useCallback(() => api.call('GET', '/hospital/requests').then((r: any[]) => setReqs(r.filter(x => x.patientId === patient.patientId))), [patient.patientId])
  useEffect(() => { load() }, [load, tick])
  useAutoRefresh(load)
  useEffect(() => { api.call('GET', '/hospital/hospitals').then(setHospitals) }, [])
  const toggle = (c: string) => setSel(s => (s.includes(c) ? s.filter(x => x !== c) : [...s, c]))
  const send = () => guard(toast, async () => {
    await api.call('POST', '/hospital/requests', { scanId: patient.scanId || undefined, patientId: patient.patientId, categories: sel, reason, sourceHospitalId: source || undefined })
    toast('Request sent to patient'); setReason(''); load()
  })
  return (
    <div className="cols">
      <div className="card">
        <h3>Request patient data</h3>
        <p className="muted">Ask only for what you need. The patient approves, narrows or denies.</p>
        <div>
          <label className="chk" style={{ fontWeight: 800 }}><input type="checkbox" checked={sel.length === REQUEST_CATS.length} onChange={e => setSel(e.target.checked ? [...REQUEST_CATS] : [])} />Select all</label>
          {REQUEST_CATS.map(c => <label key={c} className="chk"><input type="checkbox" checked={sel.includes(c)} onChange={() => toggle(c)} />{catLabel(c)}</label>)}
        </div>
        <label>Records from another hospital (optional)
          <select value={source} onChange={e => setSource(e.target.value)}>
            <option value="">Any (patient's own history)</option>
            {hospitals.map(h => <option key={h.id} value={h.id}>{h.name} only</option>)}
          </select>
        </label>
        <label>Purpose<input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Pre-operative review" /></label>
        <button disabled={!sel.length || reason.length < 3} onClick={send}>Send request</button>
      </div>
      <div>
        <h3>Requests for this patient</h3>
        {reqs.length === 0 && <p className="muted">None yet.</p>}
        {reqs.map(r => (
          <div className="card" key={r.id}>
            <div className="row"><b>{r.categories.map(catLabel).join(', ')}</b><Badge kind={r.status}>{r.status}</Badge></div>
            <div className="muted">{fmtTime(r.createdAt)}{r.sourceHospital && ` · from ${r.sourceHospital.name}`}</div>
            {r.consent && <div className="muted">Granted: {r.consent.categories.map(catLabel).join(', ')} until {fmtTime(r.consent.expiresAt)}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function Records({ me, data, err, reload, toast, goAccess }: { me: Me; data: any; err: string; reload: () => void; toast: Toast; goAccess: () => void }) {
  const [filter, setFilter] = useState('ALL')
  if (err) return <div className="card todo"><h3><Icon n="lock" style={{ color: 'var(--amber)' }} /> {err}</h3><p className="muted">Request access first. The patient must approve before any record is shown.</p><button onClick={goAccess}>Request access</button></div>
  if (!data) return null
  const open = (id: string) => guard(toast, () => api.openDoc(`/hospital/documents/${id}`))
  const canVerify = (r: Rec) => me.role === 'DOCTOR' && r.status === 'UNVERIFIED' && (r.source === 'PATIENT_UPLOAD' || (r.hospital as any)?.id === me.hospital.id)
  const verify = (id: string) => guard(toast, async () => { await api.call('POST', `/hospital/records/${id}/verify`); toast('Verified and signed'); reload() })
  // only records this hospital created (author, or any doctor) and that no doctor has signed
  const canDelete = (r: Rec) => r.status === 'UNVERIFIED' && r.source === 'HOSPITAL' && (r.hospital as any)?.id === me.hospital.id && (me.role === 'DOCTOR' || r.author === me.fullName)
  const remove = (r: Rec) => { if (confirm(`Delete "${r.title}"? This cannot be undone.`)) guard(toast, async () => { await api.call('DELETE', `/hospital/records/${r.id}`); toast('Record deleted'); reload() }) }
  const all: Rec[] = [...data.verified, ...data.unverified]
  const cats = [...new Set(all.map(r => r.category))]
  const show = (r: Rec) => filter === 'ALL' || r.category === filter
  const p = data.profile
  return (
    <>
      {p && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}><Icon n="badge" style={{ color: 'var(--secondary)' }} /> Personal info (shared by patient)</h3>
          <div className="cols" style={{ gap: 6 }}>
            <div>{p.firstName} {p.lastName} · {p.gender}<br /><span className="muted">Born {fmtDate(p.dob)}<br />{p.phone}<br />{p.email}</span></div>
            <div>Blood group <b>{p.bloodGroup ?? '?'}</b><br /><span className="muted">Allergies: {p.allergies ?? 'none recorded'}<br />Chronic: {p.chronicConditions ?? 'none recorded'}<br />Emergency contact: {p.emergencyContactName} {p.emergencyContactPhone}</span></div>
          </div>
        </div>
      )}
      <div className="subtabs">
        {['ALL', ...cats].map(c => <button key={c} className={filter === c ? 'on' : ''} onClick={() => setFilter(c)}>{c === 'ALL' ? `All (${all.length})` : catLabel(c)}</button>)}
      </div>
      <p className="muted">Existing records support, and do not replace, a current clinical evaluation.</p>
      <h3>Verified ({data.verified.filter(show).length})</h3>
      {data.verified.filter(show).map((r: Rec) => <RecordCard key={r.id} r={r} api={api} docBase="/hospital/documents/" />)}
      <h3>Unverified ({data.unverified.filter(show).length})</h3>
      {data.unverified.filter(show).map((r: Rec) => <RecordCard key={r.id} r={r} api={api} docBase="/hospital/documents/" actions={(canVerify(r) || canDelete(r)) && <div className="gap">
        {canVerify(r) && <button onClick={() => verify(r.id)}><Icon n="verified" />Verify &amp; Sign Record</button>}
        {canDelete(r) && <button className="danger" onClick={() => remove(r)}><Icon n="delete" />Delete</button>}
      </div>} />)}
    </>
  )
}

function AddRecord({ patient, toast }: { patient: Patient; toast: Toast }) {
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    if (!(fd.get('file') as File)?.size) fd.delete('file')
    guard(toast, async () => { await api.call('POST', `/hospital/patients/${patient.patientId}/records`, fd); toast('Record added, awaiting doctor verification'); form.reset() })
  }
  return (
    <form className="card" onSubmit={submit} style={{ maxWidth: 520 }}>
      <h3>Add record / upload report</h3>
      <p className="muted">New records are UNVERIFIED until a doctor signs them.</p>
      <label>Type<select name="category">{RECORD_CATS.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}</select></label>
      <label>Title<input name="title" required /></label>
      <label>Date<input name="recordDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
      <label>Clinical notes<textarea name="notes" rows={4} /></label>
      <label>Report / document (pdf, png, jpg)<input name="file" type="file" accept="application/pdf,image/png,image/jpeg" /></label>
      <button>Add record</button>
    </form>
  )
}

function Discharge({ patient, toast }: { patient: Patient; toast: Toast }) {
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    const body: any = { dischargeDate: f.dischargeDate, instructions: f.instructions }
    if (f.rxTitle) body.prescription = { title: f.rxTitle, notes: f.rxNotes || '' }
    if (f.fuDate) body.followUp = { date: f.fuDate, reason: f.fuReason || 'Follow-up', instructions: f.fuInstructions || undefined }
    guard(toast, async () => { await api.call('POST', `/hospital/patients/${patient.patientId}/discharge`, body); toast('Discharged. Signed records and reminder sent to the patient.') })
  }
  return (
    <form className="card" onSubmit={submit} style={{ maxWidth: 520 }}>
      <h3>Discharge patient</h3>
      <p className="muted">Creates a signed discharge summary (and prescription) in one step. You sign as the verifying doctor.</p>
      <label>Discharge date<input name="dischargeDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
      <label>Summary &amp; instructions<textarea name="instructions" rows={3} required /></label>
      <label>Prescription (optional)<input name="rxTitle" placeholder="e.g. Amoxicillin 500 mg" /></label>
      <label>Prescription notes<input name="rxNotes" placeholder="dose, duration" /></label>
      <h3>Follow-up (optional)</h3>
      <label>Date<input name="fuDate" type="date" /></label>
      <label>Reason<input name="fuReason" placeholder="Post-surgery examination" /></label>
      <label>Instructions<input name="fuInstructions" placeholder="Bring previous reports" /></label>
      <button>Discharge &amp; sign</button>
    </form>
  )
}

function FollowUps({ patient, toast }: { patient: Patient; toast: Toast }) {
  const [items, setItems] = useState<any[]>([])
  const load = useCallback(() => api.call('GET', `/hospital/patients/${patient.patientId}/follow-ups`).then(setItems), [patient.patientId])
  useEffect(() => { load() }, [load])
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>
    guard(toast, async () => { await api.call('POST', `/hospital/patients/${patient.patientId}/follow-ups`, { ...f, instructions: f.instructions || undefined }); toast('Reminder sent to patient'); form.reset(); load() })
  }
  return (
    <div className="cols">
      <form className="card" onSubmit={submit}>
        <h3>Create follow-up reminder</h3>
        <label>Date<input name="date" type="date" required /></label>
        <label>Reason<input name="reason" required /></label>
        <label>Instructions<input name="instructions" /></label>
        <button>Create</button>
      </form>
      <div>
        <h3>Follow-ups by this hospital</h3>
        {items.map(r => (
          <div className="card" key={r.id}>
            <div className="row"><b>{r.reason}</b><Badge kind={r.status}>{r.status}</Badge></div>
            <div className="muted">{fmtDate(r.followUpDate)}{r.instructions && ` · ${r.instructions}`}</div>
            <div className="gap" style={{ marginTop: 8 }}>
              {r.status === 'UPCOMING' && <button className="ghost" onClick={() => guard(toast, async () => { await api.call('PATCH', `/hospital/follow-ups/${r.id}`, { status: 'COMPLETED' }); load() })}>Mark completed</button>}
              <button className="danger" onClick={() => { if (confirm(`Delete the follow-up "${r.reason}"? The patient will no longer see it.`)) guard(toast, async () => { await api.call('DELETE', `/hospital/follow-ups/${r.id}`); toast('Follow-up deleted'); load() }) }}><Icon n="delete" />Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ActivePatients({ open, onOpen, tick, toast }: { open: Patient[]; onOpen: (ps: Patient[]) => void; tick: number; toast: Toast }) {
  const [items, setItems] = useState<any[] | null>(null)
  const load = useCallback(() => api.call('GET', '/hospital/active-patients').then(setItems).catch(() => {}), [])
  useEffect(() => { load() }, [load, tick])
  useAutoRefresh(load)
  const revoke = (a: any) => {
    if (!confirm(`End your access to ${a.name}'s records? You will need the patient's approval to see them again.`)) return
    guard(toast, async () => { await api.call('POST', `/hospital/patients/${a.patientId}/revoke`); toast(`Access to ${a.name} ended`); load() })
  }
  const toP = (a: any): Patient => ({ scanId: '', patientId: a.patientId, name: a.name, age: a.age })
  const isOpen = (id: string) => open.some(p => p.patientId === id)
  const left = (d: string) => { const m = Math.max(0, Math.round((+new Date(d) - Date.now()) / 60000)); return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m` }
  return (
    <>
      <div className="row"><h1><Icon n="groups" style={{ color: 'var(--primary)', fontSize: 32 }} /> Active patients</h1>
        {items && items.length > 1 && <button onClick={() => onOpen(items.map(toP))}><Icon n="tab_group" />Open all ({items.length})</button>}
      </div>
      <p className="muted">Patients whose access has not been revoked or expired. When a patient revokes, they disappear from this list.</p>
      {!items && <p className="muted">Loading…</p>}
      {items && items.length === 0 && <div className="help">No patients have active access right now. Scan a patient's QR and request access.</div>}
      <div className="cols" style={{ alignItems: 'stretch' }}>
        {items?.map(a => (
          <div key={a.patientId} className="card" style={{ margin: 0 }}>
            <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', gap: 14 }}>
              <Avatar api={api} size={56} path={a.hasPhoto ? `/hospital/patients/${a.patientId}/photo` : null} initials={a.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ margin: 0 }}>{a.name}</h3>
                <div className="muted">Age {a.age}{a.sources.length ? ` · records from ${a.sources.join(', ')}` : ''}</div>
              </div>
              <Badge kind="approved">ACTIVE</Badge>
            </div>
            <div style={{ margin: '12px 0 4px' }}>{a.categories.map((c: string) => <span key={c} className="badge" style={{ marginRight: 6, marginBottom: 6 }}>{catLabel(c)}</span>)}</div>
            <div className="mono">Access ends in {left(a.expiresAt)} · {fmtTime(a.expiresAt)}</div>
            <div className="gap" style={{ marginTop: 12 }}>
              <button onClick={() => onOpen([toP(a)])}><Icon n="open_in_new" />{isOpen(a.patientId) ? 'Go to profile' : 'Open profile'}</button>
              <button className="danger" onClick={() => revoke(a)}><Icon n="block" />Revoke access</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ---------- other pages
function Requests({ tick }: { tick: number }) {
  const [items, setItems] = useState<any[]>([])
  const load = useCallback(() => api.call('GET', '/hospital/requests').then(setItems), [])
  useEffect(() => { load() }, [load, tick])
  useAutoRefresh(load)
  return (
    <>
      <h1>Access requests &amp; consents</h1>
      <div className="card"><table><thead><tr><th>When</th><th>Patient ref</th><th>Requested</th><th>From</th><th>Purpose</th><th>Status</th></tr></thead><tbody>
        {items.map(r => (
          <tr key={r.id}><td>{fmtTime(r.createdAt)}</td><td>{r.patientId.slice(0, 8)}</td><td>{r.categories.map(catLabel).join(', ')}</td><td>{r.sourceHospital?.name ?? 'Patient'}</td><td>{r.reason}</td><td><Badge kind={r.status}>{r.status}</Badge></td></tr>
        ))}
      </tbody></table></div>
    </>
  )
}

function Emergency({ toast }: { toast: Toast }) {
  const [code, setCode] = useState('')
  const [reason, setReason] = useState('')
  const [scanning, setScanning] = useState(false)
  const [grant, setGrant] = useState<any>(null)
  const p = grant?.patient
  return (
    <>
      <h1><Icon n="local_hospital" style={{ color: 'var(--rose)', fontSize: 32 }} /> Emergency access</h1>
      <div className="card" style={{ maxWidth: 520 }}>
        <p className="muted">For patients who cannot respond. Reveals blood group, allergies, conditions and emergency contact only, for 1 hour. The patient is notified and the access is logged.</p>
        {scanning ? <Scanner onScan={t => { setCode(stripPrefix(t)); setScanning(false) }} /> : <button className="ghost" onClick={() => setScanning(true)}>Scan emergency card / family code</button>}
        <label>Card or family code<input value={code} onChange={e => setCode(e.target.value)} /></label>
        <label>Reason (required)<input value={reason} onChange={e => setReason(e.target.value)} placeholder="Unconscious after road accident" /></label>
        <button className="danger" style={{ width: '100%' }} disabled={code.length < 10 || reason.length < 5} onClick={() => guard(toast, async () => setGrant(await api.call('POST', '/hospital/emergency', { code: stripPrefix(code), reason })))}><Icon n="emergency_share" />Execute emergency override</button>
      </div>
      {p && (
        <div className="card" style={{ maxWidth: 520, borderColor: 'var(--bad)' }}>
          <h2>{p.name}</h2>
          <p><b>Blood group:</b> {p.bloodGroup ?? 'unknown'}<br /><b>Severe allergies:</b> {p.allergies ?? 'none recorded'}<br /><b>Chronic conditions:</b> {p.chronicConditions ?? 'none recorded'}<br /><b>Emergency contact:</b> {p.emergencyContactName} {p.emergencyContactPhone}</p>
          <div className="muted">Access expires {fmtTime(grant.expiresAt)}. Full history is not available.</div>
        </div>
      )}
    </>
  )
}

function Audit() {
  const [items, setItems] = useState<any[]>([])
  const load = useCallback(() => api.call('GET', '/hospital/audit').then(setItems), [])
  useEffect(() => { load() }, [load])
  useAutoRefresh(load)
  return (
    <>
      <h1>Audit trail</h1>
      <p className="muted">Patients appear only as an anonymous reference. No names are kept in access history.</p>
      <div className="card"><table><thead><tr><th>When</th><th>Transaction</th><th>Patient ref</th><th>Action</th><th>Purpose</th></tr></thead><tbody>
        {items.map(l => <tr key={l.txId}><td>{fmtTime(l.at)}</td><td>{l.txId.slice(0, 8)}</td><td>{l.patientRef}</td><td>{l.action}</td><td>{l.purpose}</td></tr>)}
      </tbody></table></div>
    </>
  )
}
