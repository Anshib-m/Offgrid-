import { useCallback, useEffect, useState } from 'react'
import { createApi, useSSE } from '../shared/api'
import { Badge, catLabel, fmtDate, fmtTime, guard, RecordCard, RECORD_CATS, REQUEST_CATS, Scanner, useToast, type Rec } from '../shared/ui'

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
    <div className="main" style={{ maxWidth: 420, margin: '10vh auto' }}>
      {toastEl}
      <h1>🏥 Offgrid · Hospital portal</h1>
      <div className="card">
        <label>Staff email<input value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></label>
        <label>Password<input type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></label>
        <button onClick={() => guard(toast, async () => { api.setToken((await api.call('POST', '/auth/staff/login', f)).token); onDone() })}>Sign in</button>
      </div>
      <p className="muted">Demo: desk@ or dr.rao@citygeneral.test, desk@ or dr.mehta@riverside.test · password demo1234</p>
    </div>
  )
}

const NAV = ['Patient desk', 'Requests', 'Emergency', 'Audit log'] as const
const NAV_ICON = { 'Patient desk': '🧑‍⚕️', Requests: '📨', Emergency: '🚨', 'Audit log': '📜' }

function Shell() {
  const [me, setMe] = useState<Me | null>(null)
  const [page, setPage] = useState<(typeof NAV)[number]>('Patient desk')
  const [tick, setTick] = useState(0)
  const [toastEl, toast] = useToast()
  const [patient, setPatientState] = useState<Patient | null>(() => JSON.parse(sessionStorage.getItem('og_ctx') ?? 'null'))
  const setPatient = (p: Patient | null) => { setPatientState(p); sessionStorage.setItem('og_ctx', JSON.stringify(p)) }
  useEffect(() => { api.call('GET', '/hospital/me').then(setMe) }, [])
  useSSE(api, '/hospital/events', { 'request-updated': () => { setTick(t => t + 1); toast('Patient responded to an access request') } })
  if (!me) return null
  return (
    <div className="shell">
      {toastEl}
      <aside className="side">
        <b>🏥 {me.hospital.name}</b>
        <div className="muted">{me.fullName} · {me.role}</div>
        <hr />
        {NAV.map(n => <button key={n} className={page === n ? 'on' : ''} onClick={() => setPage(n)}>{NAV_ICON[n]} {n}</button>)}
        <button style={{ marginTop: 'auto' }} onClick={api.logout}>Sign out</button>
      </aside>
      <main className="main">
        {page === 'Patient desk' && <Desk me={me} patient={patient} setPatient={setPatient} tick={tick} toast={toast} />}
        {page === 'Requests' && <Requests tick={tick} />}
        {page === 'Emergency' && <Emergency toast={toast} />}
        {page === 'Audit log' && <Audit />}
      </main>
    </div>
  )
}

// ---------- desk: scan or register, then work on the patient
function Desk({ me, patient, setPatient, tick, toast }: { me: Me; patient: Patient | null; setPatient: (p: Patient | null) => void; tick: number; toast: Toast }) {
  const [scanning, setScanning] = useState(false)
  const [token, setToken] = useState('')
  const [reg, setReg] = useState(false)
  const [created, setCreated] = useState<{ email: string; pw: string } | null>(null)
  const scan = (t: string) => guard(toast, async () => {
    const s = await api.call('POST', '/hospital/scan', { token: stripPrefix(t) })
    setPatient(s); setScanning(false); setToken(''); toast(`Identified ${s.name}, ${s.age}. Request access to see records.`)
  })
  const register = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    guard(toast, async () => {
      const r = await api.call('POST', '/hospital/patients', f)
      setPatient({ scanId: r.scanId, patientId: r.patientId, name: `${f.firstName} ${f.lastName}` })
      setCreated({ email: f.email, pw: r.tempPassword }); setReg(false)
    })
  }
  return (
    <>
      <h1>Patient desk</h1>
      <div className="cols">
        <div className="card">
          <h3>① Identify the patient</h3>
          {scanning ? <><Scanner onScan={scan} /><button className="ghost" onClick={() => setScanning(false)}>Stop camera</button></> : <button onClick={() => setScanning(true)}>Open camera</button>}
          <p className="muted">No camera? Type or paste the code shown in the patient app:</p>
          <input value={token} onChange={e => setToken(e.target.value)} placeholder="offgrid:id:..." />
          <button disabled={!token} onClick={() => scan(token)}>Identify patient</button>
        </div>
        <div className="card">
          <h3>Or register a new patient</h3>
          {!reg ? <button className="ghost" onClick={() => setReg(true)}>Register patient</button> : (
            <form onSubmit={register}>
              <label>First name<input name="firstName" required /></label><label>Last name<input name="lastName" required /></label>
              <label>Email<input name="email" type="email" required /></label><label>Phone<input name="phone" required /></label>
              <label>Date of birth<input name="dob" type="date" required /></label><label>Gender<input name="gender" required /></label>
              <button>Register</button>
            </form>
          )}
          {created && <div className="alert ok">Account created for {created.email}. One-time password: <b>{created.pw}</b>. Give it to the patient now.</div>}
        </div>
      </div>
      {!patient && <div className="help" style={{ marginTop: 12 }}>Start here: scan the patient's QR, or register a walk-in. Then request access to their records.</div>}
      {patient && <Workspace key={patient.patientId} me={me} patient={patient} tick={tick} toast={toast} close={() => setPatient(null)} />}
    </>
  )
}

function Workspace({ me, patient, tick, toast, close }: { me: Me; patient: Patient; tick: number; toast: Toast; close: () => void }) {
  const tabs = ['Access', 'Records', 'Add record', ...(me.role === 'DOCTOR' ? ['Discharge'] : []), 'Follow-ups']
  const [tab, setTab] = useState('Access')
  return (
    <>
      <div className="row"><h2>{patient.name}{patient.age != null && `, ${patient.age}`}</h2><button className="ghost" onClick={close}>Close patient</button></div>
      <div className="subtabs">{tabs.map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === 'Access' && <Access patient={patient} tick={tick} toast={toast} />}
      {tab === 'Records' && <Records me={me} patient={patient} tick={tick} toast={toast} goAccess={() => setTab('Access')} />}
      {tab === 'Add record' && <AddRecord patient={patient} toast={toast} />}
      {tab === 'Discharge' && <Discharge patient={patient} toast={toast} />}
      {tab === 'Follow-ups' && <FollowUps patient={patient} toast={toast} />}
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
  useEffect(() => { api.call('GET', '/hospital/hospitals').then(setHospitals) }, [])
  const toggle = (c: string) => setSel(s => (s.includes(c) ? s.filter(x => x !== c) : [...s, c]))
  const send = () => guard(toast, async () => {
    await api.call('POST', '/hospital/requests', { scanId: patient.scanId, categories: sel, reason, sourceHospitalId: source || undefined })
    toast('Request sent to patient'); setReason(''); load()
  })
  return (
    <div className="cols">
      <div className="card">
        <h3>Request patient data</h3>
        <p className="muted">Ask only for what you need. The patient approves, narrows or denies.</p>
        <div>{REQUEST_CATS.map(c => <label key={c} className="chk"><input type="checkbox" checked={sel.includes(c)} onChange={() => toggle(c)} />{catLabel(c)}</label>)}</div>
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

function Records({ me, patient, tick, toast, goAccess }: { me: Me; patient: Patient; tick: number; toast: Toast; goAccess: () => void }) {
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => api.call('GET', `/hospital/patients/${patient.patientId}/records`).then(d => { setData(d); setErr('') }).catch(e => { setData(null); setErr(e.message) }), [patient.patientId])
  useEffect(() => { load() }, [load, tick])
  if (err) return <div className="card"><b>🔒 {err}</b><p className="muted">Request access first. The patient must approve.</p><button onClick={goAccess}>Request access</button></div>
  if (!data) return null
  const open = (id: string) => guard(toast, () => api.openDoc(`/hospital/documents/${id}`))
  const canVerify = (r: Rec) => me.role === 'DOCTOR' && r.status === 'UNVERIFIED' && (r.source === 'PATIENT_UPLOAD' || (r.hospital as any)?.id === me.hospital.id)
  const verify = (id: string) => guard(toast, async () => { await api.call('POST', `/hospital/records/${id}/verify`); toast('Verified and signed'); load() })
  const p = data.profile
  return (
    <>
      <div className="card muted">Access: {data.consents.map((c: any) => `${c.categories.map(catLabel).join(', ')} (until ${fmtTime(c.expiresAt)})`).join(' · ')}</div>
      {p && (
        <div className="card">
          <h3>Personal info (shared by patient)</h3>
          {p.firstName} {p.lastName} · {p.gender} · born {fmtDate(p.dob)} · {p.phone} · {p.email}<br />
          Blood group {p.bloodGroup ?? '?'} · Allergies: {p.allergies ?? 'none recorded'} · Chronic: {p.chronicConditions ?? 'none recorded'}<br />
          Emergency contact: {p.emergencyContactName} {p.emergencyContactPhone}
        </div>
      )}
      <p className="muted">Existing records support, and do not replace, a current clinical evaluation.</p>
      <h3>✓ Verified ({data.verified.length})</h3>
      {data.verified.map((r: Rec) => <RecordCard key={r.id} r={r} onDoc={open} />)}
      <h3>Unverified ({data.unverified.length})</h3>
      {data.unverified.map((r: Rec) => <RecordCard key={r.id} r={r} onDoc={open} actions={canVerify(r) && <button onClick={() => verify(r.id)}>Verify &amp; sign</button>} />)}
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
            {r.status === 'UPCOMING' && <button className="ghost" onClick={() => guard(toast, async () => { await api.call('PATCH', `/hospital/follow-ups/${r.id}`, { status: 'COMPLETED' }); load() })}>Mark completed</button>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- other pages
function Requests({ tick }: { tick: number }) {
  const [items, setItems] = useState<any[]>([])
  useEffect(() => { api.call('GET', '/hospital/requests').then(setItems) }, [tick])
  return (
    <>
      <h1>Access requests sent</h1>
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
      <h1>🚨 Emergency access</h1>
      <div className="card" style={{ maxWidth: 520 }}>
        <p className="muted">For patients who cannot respond. Reveals blood group, allergies, conditions and emergency contact only, for 1 hour. The patient is notified and the access is logged.</p>
        {scanning ? <Scanner onScan={t => { setCode(stripPrefix(t)); setScanning(false) }} /> : <button className="ghost" onClick={() => setScanning(true)}>Scan emergency card / family code</button>}
        <label>Card or family code<input value={code} onChange={e => setCode(e.target.value)} /></label>
        <label>Reason (required)<input value={reason} onChange={e => setReason(e.target.value)} placeholder="Unconscious after road accident" /></label>
        <button className="danger" disabled={code.length < 10 || reason.length < 5} onClick={() => guard(toast, async () => setGrant(await api.call('POST', '/hospital/emergency', { code: stripPrefix(code), reason })))}>Break glass</button>
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
  useEffect(() => { api.call('GET', '/hospital/audit').then(setItems) }, [])
  return (
    <>
      <h1>Audit log</h1>
      <p className="muted">Patients appear only as an anonymous reference. No names are kept in access history.</p>
      <div className="card"><table><thead><tr><th>When</th><th>Transaction</th><th>Patient ref</th><th>Action</th><th>Purpose</th></tr></thead><tbody>
        {items.map(l => <tr key={l.txId}><td>{fmtTime(l.at)}</td><td>{l.txId.slice(0, 8)}</td><td>{l.patientRef}</td><td>{l.action}</td><td>{l.purpose}</td></tr>)}
      </tbody></table></div>
    </>
  )
}
