import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import QRCode from 'react-native-qrcode-svg'
import * as DocumentPicker from 'expo-document-picker'
import { AuthError, call, loadToken, saveToken } from './src/api'

const C = { bg: '#f4f7f6', ink: '#12302d', muted: '#5c7370', brand: '#0f766e', line: '#dbe5e3', ok: '#15803d', warn: '#b45309', bad: '#b91c1c' }
const RECORD_CATS = ['SURGERY', 'LAB', 'IMAGING', 'MEDICATION', 'ALLERGY', 'DIAGNOSIS', 'CONSULTATION', 'DISCHARGE', 'OTHER']
const label = (c: string) => (c === 'PROFILE' ? 'Personal info' : c.charAt(0) + c.slice(1).toLowerCase())
const date = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const time = (d: string) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const fail = (e: unknown) => Alert.alert('Error', (e as Error).message)

export default function App() {
  const [ready, setReady] = useState(false)
  const [authed, setAuthed] = useState(false)
  useEffect(() => { loadToken().then(t => { setAuthed(!!t); setReady(true) }) }, [])
  if (!ready) return <View style={s.fill}><ActivityIndicator /></View>
  return (
    <SafeAreaView style={s.fill}>
      <StatusBar style="dark" />
      {authed ? <Main onLogout={async () => { await saveToken(null); setAuthed(false) }} /> : <Login onDone={() => setAuthed(true)} />}
    </SafeAreaView>
  )
}

// ---------- small UI helpers
const Btn = ({ title, onPress, kind = 'primary', disabled }: { title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; disabled?: boolean }) => (
  <Pressable disabled={disabled} onPress={onPress} style={[s.btn, kind === 'ghost' && s.btnGhost, kind === 'danger' && { backgroundColor: C.bad }, disabled && { opacity: 0.5 }]}>
    <Text style={[s.btnText, kind === 'ghost' && { color: C.brand }]}>{title}</Text>
  </Pressable>
)
const Card = ({ children, style }: { children: React.ReactNode; style?: object }) => <View style={[s.card, style]}>{children}</View>
const Badge = ({ text }: { text: string }) => {
  const color = ['VERIFIED', 'APPROVED', 'COMPLETED'].includes(text) ? C.ok : ['PENDING', 'UPCOMING', 'UNVERIFIED'].includes(text) ? C.warn : C.bad
  return <Text style={[s.badge, { color, borderColor: color }]}>{text}</Text>
}
const Field = (p: { label: string } & React.ComponentProps<typeof TextInput>) => (
  <View style={{ marginBottom: 10 }}><Text style={s.muted}>{p.label}</Text><TextInput {...p} style={s.input} autoCapitalize="none" /></View>
)

function Login({ onDone }: { onDone: () => void }) {
  const [reg, setReg] = useState(false)
  const [f, setF] = useState<Record<string, string>>({ email: 'asha@example.test', password: 'demo1234' })
  const [busy, setBusy] = useState(false)
  const set = (k: string) => (v: string) => setF({ ...f, [k]: v })
  const submit = async () => {
    setBusy(true)
    try { await saveToken((await call('POST', reg ? '/auth/patient/register' : '/auth/patient/login', f)).token); onDone() } catch (e) { fail(e) }
    setBusy(false)
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 60 }} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>🩺 Offgrid</Text>
      <Text style={[s.muted, { marginBottom: 20 }]}>Your medical history. You decide who sees it.</Text>
      <Card>
        {reg && <>
          <Field label="First name" onChangeText={set('firstName')} />
          <Field label="Last name" onChangeText={set('lastName')} />
          <Field label="Date of birth (YYYY-MM-DD)" onChangeText={set('dob')} />
          <Text style={s.muted}>Gender</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, marginTop: 4 }}>
            {['Male', 'Female', 'Other'].map(g => <Pressable key={g} onPress={() => set('gender')(g)} style={[s.chip, f.gender === g && s.chipOn]}><Text style={f.gender === g ? { color: '#fff' } : undefined}>{g}</Text></Pressable>)}
          </View>
          <Field label="Phone" onChangeText={set('phone')} keyboardType="phone-pad" />
        </>}
        <Field label="Email" value={f.email} onChangeText={set('email')} keyboardType="email-address" />
        <Field label="Password" value={f.password} onChangeText={set('password')} secureTextEntry />
        <Btn title={busy ? '…' : reg ? 'Create account' : 'Sign in'} disabled={busy} onPress={submit} />
        <View style={{ height: 8 }} />
        <Btn title={reg ? 'I have an account' : 'Register'} kind="ghost" onPress={() => setReg(!reg)} />
      </Card>
    </ScrollView>
  )
}

const TABS = ['Home', 'Requests', 'Records', 'Follow-ups', 'Me'] as const
function Main({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Home')
  const [requests, setRequests] = useState<any[]>([])
  const [records, setRecords] = useState<any[]>([])
  const [reminders, setReminders] = useState<any[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const load = useCallback(async () => {
    try {
      const [a, b, c] = await Promise.all([call('GET', '/patient/requests'), call('GET', '/patient/records'), call('GET', '/patient/reminders')])
      setRequests(a); setRecords(b); setReminders(c)
    } catch (e) { if (e instanceof AuthError) onLogout() }
  }, [onLogout])
  // ponytail: polling instead of SSE/push. Add FCM/APNs for background alerts.
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [load])
  const pending = requests.filter(r => r.status === 'PENDING')
  return (
    <View style={s.fill}>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} />}>
        {tab === 'Home' && <Home pending={pending.length} go={() => setTab('Requests')} />}
        {tab === 'Requests' && <Requests requests={requests} reload={load} />}
        {tab === 'Records' && <Records records={records} reload={load} />}
        {tab === 'Follow-ups' && <Reminders items={reminders} />}
        {tab === 'Me' && <Me onLogout={onLogout} />}
      </ScrollView>
      <View style={s.tabs}>
        {TABS.map(t => (
          <Pressable key={t} style={s.tab} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && { color: C.brand, fontWeight: '700' }]}>{t}{t === 'Requests' && pending.length ? ` (${pending.length})` : ''}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function Home({ pending, go }: { pending: number; go: () => void }) {
  const [qr, setQr] = useState<{ token: string; expiresAt: string } | null>(null)
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!qr) return
    const t = setInterval(() => { const sec = Math.round((+new Date(qr.expiresAt) - Date.now()) / 1000); setLeft(sec); if (sec <= 0) setQr(null) }, 500)
    return () => clearInterval(t)
  }, [qr])
  return (
    <>
      <Text style={s.h1}>My identity</Text>
      <Card style={{ alignItems: 'center' }}>
        {qr ? <>
          <QRCode value={`offgrid:id:${qr.token}`} size={220} />
          <Text style={[s.muted, { marginVertical: 10, textAlign: 'center' }]}>One-time code, valid {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}. It holds no medical data.</Text>
        </> : <Text style={[s.muted, { marginBottom: 12, textAlign: 'center' }]}>Show this at a hospital desk. They scan it, then ask you for approval.</Text>}
        <Btn title={qr ? 'New code' : 'Show my QR'} onPress={() => call('POST', '/patient/qr').then(setQr).catch(fail)} />
      </Card>
      {pending > 0 && <Card><View style={s.row}><Text style={s.bold}>{pending} pending request{pending > 1 ? 's' : ''}</Text><Btn title="Review" onPress={go} /></View></Card>}
    </>
  )
}

function Requests({ requests, reload }: { requests: any[]; reload: () => void }) {
  const pending = requests.filter(r => r.status === 'PENDING')
  return (
    <>
      <Text style={s.h1}>Access requests</Text>
      {!pending.length && <Text style={s.muted}>Nothing waiting for you.</Text>}
      {pending.map(r => <Pending key={r.id} r={r} reload={reload} />)}
      {requests.length > pending.length && <Text style={[s.h2, { marginTop: 16 }]}>History</Text>}
      {requests.filter(r => r.status !== 'PENDING').map(r => (
        <Card key={r.id}>
          <View style={s.row}><Text style={s.bold}>{r.requestingHospital.name}</Text><Badge text={r.status} /></View>
          <Text style={s.muted}>{time(r.createdAt)} · {r.categories.map(label).join(', ')}</Text>
        </Card>
      ))}
    </>
  )
}

const DURATIONS = [{ h: 1, t: '1 hour' }, { h: 24, t: '24 hours' }, { h: 168, t: '7 days' }]
function Pending({ r, reload }: { r: any; reload: () => void }) {
  const [sel, setSel] = useState<string[]>(r.categories)
  const [hours, setHours] = useState(24)
  const act = (path: string, body?: object) => call('POST', `/patient/requests/${r.id}/${path}`, body).then(reload).catch(fail)
  return (
    <Card>
      <Text style={s.bold}>{r.requestingHospital.name}</Text>
      <Text style={s.muted}>{r.sourceHospital ? `wants records held by ${r.sourceHospital.name}` : 'wants access to your records'}</Text>
      <Text style={{ marginVertical: 8 }}>“{r.reason}”</Text>
      {r.categories.map((c: string) => (
        <View key={c} style={[s.row, { marginBottom: 4 }]}>
          <Text>{label(c)}</Text>
          <Switch value={sel.includes(c)} onValueChange={v => setSel(v ? [...sel, c] : sel.filter(x => x !== c))} trackColor={{ true: C.brand }} />
        </View>
      ))}
      <Text style={[s.muted, { marginTop: 8 }]}>Access lasts</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 6 }}>
        {DURATIONS.map(d => <Pressable key={d.h} onPress={() => setHours(d.h)} style={[s.chip, hours === d.h && s.chipOn]}><Text style={hours === d.h ? { color: '#fff' } : undefined}>{d.t}</Text></Pressable>)}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
        <View style={{ flex: 1 }}><Btn title="Approve" disabled={!sel.length} onPress={() => act('approve', { categories: sel, hours })} /></View>
        <View style={{ flex: 1 }}><Btn title="Deny" kind="danger" onPress={() => act('deny')} /></View>
      </View>
    </Card>
  )
}

function RecordCard({ r }: { r: any }) {
  const v = r.verification
  return (
    <Card style={{ borderLeftWidth: 4, borderLeftColor: r.status === 'VERIFIED' ? C.ok : '#f59e0b' }}>
      <View style={s.row}><Text style={[s.bold, { flex: 1 }]}>{r.title}</Text><Badge text={r.status} /></View>
      <Text style={s.muted}>{label(r.category)} · {date(r.recordDate)}</Text>
      {r.notes && <Text style={{ marginVertical: 6 }}>{r.notes}</Text>}
      <Text style={[s.muted, { fontSize: 12, marginTop: 4 }]}>
        Source: {r.source === 'PATIENT_UPLOAD' ? 'Patient upload' : r.hospital?.name}{r.author ? ` · Created by ${r.author}` : ''}
        {v ? `\nVerified by ${v.doctor} (${v.hospital}) · ${date(v.verifiedAt)} · ${v.signatureValid ? '✓ signature valid' : '⚠ SIGNATURE INVALID'}` : '\nNot verified by a doctor. Not part of your verified history.'}
        {r.documents.length ? `\n📎 ${r.documents.map((d: any) => d.fileName).join(', ')}` : ''}
      </Text>
    </Card>
  )
}

function Records({ records, reload }: { records: any[]; reload: () => void }) {
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ category: 'LAB', title: '', recordDate: new Date().toISOString().slice(0, 10), notes: '' })
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null)
  const submit = async () => {
    const fd = new FormData()
    Object.entries(f).forEach(([k, v]) => v && fd.append(k, v))
    if (file) fd.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/pdf' } as any)
    try { await call('POST', '/patient/records', fd); setAdding(false); setFile(null); setF({ ...f, title: '', notes: '' }); reload(); Alert.alert('Uploaded', 'Stays UNVERIFIED until a doctor signs it.') } catch (e) { fail(e) }
  }
  const verified = records.filter(r => r.status === 'VERIFIED')
  const unverified = records.filter(r => r.status === 'UNVERIFIED')
  return (
    <>
      <View style={s.row}><Text style={s.h1}>Medical history</Text><Btn title={adding ? 'Cancel' : '+ Upload'} kind="ghost" onPress={() => setAdding(!adding)} /></View>
      {adding && (
        <Card>
          <Text style={[s.muted, { marginBottom: 8 }]}>Your uploads stay unverified until a doctor reviews and signs them.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {RECORD_CATS.map(c => <Pressable key={c} onPress={() => setF({ ...f, category: c })} style={[s.chip, f.category === c && s.chipOn]}><Text style={f.category === c ? { color: '#fff' } : undefined}>{label(c)}</Text></Pressable>)}
          </View>
          <Field label="Title" value={f.title} onChangeText={v => setF({ ...f, title: v })} />
          <Field label="Date (YYYY-MM-DD)" value={f.recordDate} onChangeText={v => setF({ ...f, recordDate: v })} />
          <Field label="Notes" value={f.notes} onChangeText={v => setF({ ...f, notes: v })} multiline />
          <Btn title={file ? `📎 ${file.name}` : 'Attach file (pdf/png/jpg)'} kind="ghost" onPress={async () => { const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/png', 'image/jpeg'] }); if (!r.canceled) setFile(r.assets[0]) }} />
          <View style={{ height: 8 }} />
          <Btn title="Upload" disabled={!f.title} onPress={submit} />
        </Card>
      )}
      <Text style={s.h2}>✓ Verified ({verified.length})</Text>
      {verified.map(r => <RecordCard key={r.id} r={r} />)}
      <Text style={s.h2}>Unverified ({unverified.length})</Text>
      {unverified.map(r => <RecordCard key={r.id} r={r} />)}
    </>
  )
}

function Reminders({ items }: { items: any[] }) {
  return (
    <>
      <Text style={s.h1}>Follow-ups</Text>
      {!items.length && <Text style={s.muted}>No follow-ups.</Text>}
      {items.map(r => (
        <Card key={r.id}>
          <View style={s.row}><Text style={[s.bold, { flex: 1 }]}>{r.reason}</Text><Badge text={r.status} /></View>
          <Text>📅 {date(r.followUpDate)} · {r.hospital.name}</Text>
          {r.instructions && <Text style={s.muted}>{r.instructions}</Text>}
        </Card>
      ))}
    </>
  )
}

function Me({ onLogout }: { onLogout: () => void }) {
  const [me, setMe] = useState<any>(null)
  const [consents, setConsents] = useState<any[]>([])
  const [cards, setCards] = useState<any[]>([])
  const [hist, setHist] = useState<any[]>([])
  const [card, setCard] = useState<{ code: string; holder: string } | null>(null)
  const load = useCallback(() => {
    call('GET', '/patient/me').then(setMe).catch(fail)
    call('GET', '/patient/consents').then(setConsents).catch(() => {})
    call('GET', '/patient/emergency-cards').then(setCards).catch(() => {})
    call('GET', '/patient/access-history').then(setHist).catch(() => {})
  }, [])
  useEffect(load, [load])
  if (!me) return <ActivityIndicator />
  const field = (k: string, l: string) => <Field label={l} value={me[k] ?? ''} onChangeText={v => setMe({ ...me, [k]: v })} />
  const active = consents.filter(c => !c.revokedAt && new Date(c.expiresAt) > new Date())
  const newCard = (kind: 'CARD' | 'FAMILY', holderName: string) => call('POST', '/patient/emergency-cards', { kind, holderName }).then(r => { setCard({ code: r.code, holder: holderName }); load() }).catch(fail)
  return (
    <>
      <Text style={s.h1}>{me.firstName} {me.lastName}</Text>
      <Card>
        <Text style={s.h2}>Personal & emergency info</Text>
        {field('phone', 'Phone')}{field('bloodGroup', 'Blood group')}{field('allergies', 'Severe allergies')}
        {field('chronicConditions', 'Chronic conditions')}{field('emergencyContactName', 'Emergency contact')}{field('emergencyContactPhone', 'Emergency contact phone')}
        <Btn title="Save" onPress={() => {
          const { phone, bloodGroup, allergies, chronicConditions, emergencyContactName, emergencyContactPhone } = me
          call('PATCH', '/patient/me', { phone, bloodGroup, allergies, chronicConditions, emergencyContactName, emergencyContactPhone }).then(setMe).then(() => Alert.alert('Saved')).catch(fail)
        }} />
      </Card>
      <Card>
        <Text style={s.h2}>Who can see my data now</Text>
        {!active.length && <Text style={s.muted}>No hospital has active access.</Text>}
        {active.map(c => (
          <View key={c.id} style={[s.row, { marginBottom: 10 }]}>
            <View style={{ flex: 1 }}>
              <Text style={s.bold}>{c.hospital}{c.sourceHospital ? ` (records from ${c.sourceHospital})` : ''}</Text>
              <Text style={s.muted}>{c.categories.map(label).join(', ')} · until {time(c.expiresAt)}</Text>
            </View>
            <Btn title="Revoke" kind="danger" onPress={() => call('POST', `/patient/consents/${c.id}/revoke`).then(load).catch(fail)} />
          </View>
        ))}
      </Card>
      <Card>
        <Text style={s.h2}>Emergency access</Text>
        <Text style={[s.muted, { marginBottom: 8 }]}>If you cannot use your phone, a hospital can scan this card or a family code. They see blood group, allergies, conditions and your emergency contact for 1 hour. Every use is logged.</Text>
        {cards.map(c => (
          <View key={c.id} style={[s.row, { marginBottom: 6 }]}>
            <Text>{c.kind === 'CARD' ? '💳' : '👪'} {c.holderName}</Text>
            <Btn title="Revoke" kind="ghost" onPress={() => call('DELETE', `/patient/emergency-cards/${c.id}`).then(load).catch(fail)} />
          </View>
        ))}
        {card && <View style={{ alignItems: 'center', marginVertical: 10 }}><QRCode value={`offgrid:em:${card.code}`} size={180} /><Text style={s.muted}>{card.holder}: shown once. Save it now.</Text><Text selectable style={s.muted}>{card.code}</Text></View>}
        <Btn title="New emergency card" onPress={() => newCard('CARD', `${me.firstName} ${me.lastName}`)} />
        <View style={{ height: 8 }} />
        <Btn title="Add family member" kind="ghost" onPress={() => Alert.prompt('Family member name', undefined, n => n && newCard('FAMILY', n))} />
      </Card>
      <Card>
        <Text style={s.h2}>Access history</Text>
        {hist.map(h => <View key={h.txId} style={{ marginBottom: 6 }}><Text>{h.hospital}</Text><Text style={s.muted}>{h.action} · {time(h.at)}</Text></View>)}
      </Card>
      <Btn title="Sign out" kind="ghost" onPress={onLogout} />
      <View style={{ height: 20 }} />
    </>
  )
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  h1: { fontSize: 24, fontWeight: '700', color: C.ink, marginBottom: 10 },
  h2: { fontSize: 17, fontWeight: '700', color: C.ink, marginVertical: 8 },
  bold: { fontWeight: '700', color: C.ink },
  muted: { color: C.muted, fontSize: 13 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 14, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 10, backgroundColor: '#fff', marginTop: 4, fontSize: 16 },
  btn: { backgroundColor: C.brand, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.brand },
  btnText: { color: '#fff', fontWeight: '600' },
  badge: { fontSize: 11, fontWeight: '700', borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#fff' },
  chipOn: { backgroundColor: C.brand, borderColor: C.brand },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.line, paddingBottom: 18 },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabText: { fontSize: 12, color: C.muted },
})
