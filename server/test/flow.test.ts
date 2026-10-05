// Runs the whole hackathon journey against the seeded DB (npm run seed first).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { app } from '../src/app.js'

const srv = app.listen(0)
const base = `http://localhost:${(srv.address() as AddressInfo).port}/api`
const call = async (method: string, path: string, token?: string, body?: unknown) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: await r.json().catch(() => null) as any }
}
const login = async (kind: 'patient' | 'staff', email: string) => (await call('POST', `/auth/${kind}/login`, undefined, { email, password: 'demo1234' })).body.token as string

test('consent, verification, provenance, emergency', async () => {
  const patient = await login('patient', 'asha@example.test')
  const docA = await login('staff', 'dr.rao@citygeneral.test')
  const docB = await login('staff', 'dr.mehta@riverside.test')
  const deskB = await login('staff', 'desk@riverside.test')

  // start clean: earlier runs may have left an active consent for Riverside
  for (const c of (await call('GET', '/patient/consents', patient)).body)
    if (!c.revokedAt && new Date(c.expiresAt) > new Date() && c.hospital?.startsWith('Riverside')) await call('POST', `/patient/consents/${c.id}/revoke`, patient)

  assert.equal((await call('POST', '/auth/staff/login', undefined, { email: 'dr.rao@citygeneral.test', password: 'wrong' })).status, 401)
  assert.equal((await call('GET', '/patient/records')).status, 401)
  assert.equal((await call('GET', '/patient/records', docA)).status, 401, 'hospital token cannot use patient API')

  // QR: opaque, single use
  const qr = (await call('POST', '/patient/qr', patient)).body.token
  const scan = (await call('POST', '/hospital/scan', deskB, { token: qr })).body
  assert.equal(scan.name, 'Asha Verma'); assert.ok(scan.age > 30)
  assert.equal((await call('POST', '/hospital/scan', deskB, { token: qr })).status, 410, 'QR reuse')

  // B has no consent yet
  assert.equal((await call('GET', `/hospital/patients/${scan.patientId}/records`, deskB)).status, 403)

  // B asks for Hospital A's surgery+lab+meds
  const hosA = (await call('GET', '/hospital/hospitals', deskB)).body.find((h: any) => h.name.startsWith('City'))
  const reqRes = await call('POST', '/hospital/requests', deskB, { scanId: scan.scanId, categories: ['SURGERY', 'LAB', 'MEDICATION'], reason: 'Pre-op review', sourceHospitalId: hosA.id })
  assert.equal(reqRes.status, 201)
  assert.equal((await call('POST', '/hospital/requests', deskB, { scanId: crypto.randomUUID(), categories: ['LAB'], reason: 'x y z' })).status, 403, 'needs a real scan')
  assert.equal((await call('GET', `/hospital/patients/${scan.patientId}/records`, deskB)).status, 403, 'pending is not consent')

  // patient approves a subset (drops LAB) and cannot widen
  assert.equal((await call('POST', `/patient/requests/${reqRes.body.id}/approve`, patient, { categories: ['SURGERY', 'MEDICATION', 'CONSULTATION'], hours: 1 })).status, 200)
  const view = (await call('GET', `/hospital/patients/${scan.patientId}/records`, deskB)).body
  // B may always see records it authored itself (left by earlier runs), so check only Hospital A's
  const cats = [...view.verified, ...view.unverified].filter((r: any) => r.hospital?.name.startsWith('City')).map((r: any) => r.category).sort()
  assert.deepEqual(cats, ['MEDICATION', 'SURGERY'], 'only approved categories, only from source hospital')
  assert.equal(view.profile, null, 'profile not granted')
  const surgery = view.verified.find((r: any) => r.category === 'SURGERY')
  assert.equal(surgery.verification.doctor, 'Dr. Meera Rao'); assert.equal(surgery.verification.signatureValid, true)

  // active patients list: approved patient appears, and B may re-request without a fresh scan
  const listed = (await call('GET', '/hospital/active-patients', deskB)).body
  assert.ok(listed.some((a: any) => a.patientId === scan.patientId && a.name === 'Asha Verma'), 'listed while consent is active')
  const again = await call('POST', '/hospital/requests', deskB, { patientId: scan.patientId, categories: ['LAB'], reason: 'Follow-up tests' })
  assert.equal(again.status, 201, 'active consent is enough to ask for more')
  await call('POST', `/patient/requests/${again.body.id}/deny`, patient)
  assert.equal((await call('POST', '/hospital/requests', docA, { patientId: crypto.randomUUID(), categories: ['LAB'], reason: 'random id probe' })).status, 403, 'no scan and no consent')

  // B's doctor cannot verify A's record, A's own unverified patient upload is not visible to B (LAB not consented)
  assert.equal((await call('POST', `/hospital/records/${surgery.id}/verify`, docB)).status, 403)
  // reception cannot verify at all
  assert.equal((await call('POST', `/hospital/records/${surgery.id}/verify`, deskB)).status, 401)

  // B adds its own record: unverified until doctor signs
  const created = await call('POST', `/hospital/patients/${scan.patientId}/records`, deskB, { category: 'LAB', title: 'Repeat CBC', recordDate: '2026-10-05' })
  assert.equal(created.body.status, 'UNVERIFIED')
  assert.equal((await call('POST', `/hospital/records/${created.body.id}/verify`, docB)).body.verification.hospital, 'Riverside Medical Centre')

  // profile photo: patient can set it, hospital needs a PROFILE consent to see it
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
  const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'me.png')
  const put = await fetch(base + '/patient/me/photo', { method: 'POST', headers: { authorization: `Bearer ${patient}` }, body: fd })
  assert.equal((await put.json() as any).hasPhoto, true)
  assert.equal((await fetch(base + '/patient/me/photo', { headers: { authorization: `Bearer ${patient}` } })).status, 200)
  assert.equal((await call('GET', `/hospital/patients/${scan.patientId}/photo`, deskB)).status, 403, 'consent without PROFILE hides the photo')
  const bad = new FormData(); bad.append('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'x.pdf')
  assert.equal((await fetch(base + '/patient/me/photo', { method: 'POST', headers: { authorization: `Bearer ${patient}` }, body: bad })).status, 400, 'photo must be an image')

  // follow-ups: created by a hospital, deletable only by that hospital
  const fu = await call('POST', `/hospital/patients/${scan.patientId}/follow-ups`, deskB, { date: '2026-12-01', reason: 'Entered by mistake' })
  assert.equal(fu.status, 201)
  assert.equal((await call('DELETE', `/hospital/follow-ups/${fu.body.id}`, docA)).status, 404, 'another hospital cannot delete it')
  assert.ok((await call('GET', '/patient/reminders', patient)).body.some((r: any) => r.id === fu.body.id), 'patient sees it')
  assert.equal((await call('DELETE', `/hospital/follow-ups/${fu.body.id}`, deskB)).status, 200)
  assert.ok(!(await call('GET', '/patient/reminders', patient)).body.some((r: any) => r.id === fu.body.id), 'gone for the patient too')

  // visits: reception assigns an available doctor, the doctor's arrival scan starts the consultation
  for (const v of (await call('GET', '/hospital/visits', deskB)).body.filter((v: any) => v.patient.id === scan.patientId && ['WAITING', 'IN_CONSULT'].includes(v.status))) {
    if (v.status === 'WAITING') await call('POST', `/hospital/visits/${v.id}/cancel`, deskB)
    else await call('POST', `/hospital/visits/${v.id}/complete`, docB) // leftovers from an aborted earlier run
  }
  const mehta = (await call('GET', '/hospital/doctors', deskB)).body.find((d: any) => d.fullName.includes('Mehta'))
  assert.equal(mehta.availability, 'AVAILABLE')
  const visit = await call('POST', '/hospital/visits', deskB, { patientId: scan.patientId, doctorId: mehta.id, reason: 'Chest pain review' })
  assert.equal(visit.status, 201); assert.equal(visit.body.status, 'WAITING')
  assert.equal((await call('POST', '/hospital/visits', deskB, { patientId: scan.patientId, doctorId: mehta.id, reason: 'again' })).status, 409, 'one active visit per patient')
  await call('PATCH', '/hospital/me/availability', docB, { status: 'BUSY' })
  const busy = await call('POST', '/hospital/visits', deskB, { patientId: scan.patientId, doctorId: mehta.id, reason: 'while busy' })
  assert.equal(busy.status, 409); assert.match(busy.body.error, /not available/, 'busy doctors cannot be assigned')
  await call('PATCH', '/hospital/me/availability', docB, { status: 'AVAILABLE' })
  assert.equal((await call('PATCH', '/hospital/me/availability', deskB, { status: 'BUSY' })).status, 401, 'reception has no availability')
  assert.equal((await call('POST', '/hospital/visits', docA, { patientId: scan.patientId, doctorId: mehta.id, reason: 'other hospital' })).status, 404, 'a doctor of another hospital cannot be assigned')

  const arrQr = (await call('POST', '/patient/qr', patient)).body.token
  assert.equal((await call('POST', '/hospital/visits/arrive', deskB, { token: arrQr })).status, 401, 'only doctors scan on arrival')
  assert.equal((await call('POST', '/hospital/visits/arrive', docA, { token: arrQr })).status, 403, 'doctor not assigned to this patient')
  const arrived = await call('POST', '/hospital/visits/arrive', docB, { token: arrQr })
  assert.equal(arrived.status, 200, 'wrong doctor did not spend the QR'); assert.equal(arrived.body.name, 'Asha Verma'); assert.equal(arrived.body.visit.status, 'IN_CONSULT')
  assert.equal((await call('POST', '/hospital/visits/arrive', docB, { token: arrQr })).status, 410, 'QR is single use')
  assert.equal((await call('GET', '/patient/visits', patient)).body[0].status, 'IN_CONSULT')
  assert.equal((await call('POST', `/hospital/visits/${visit.body.id}/complete`, deskB)).status, 401)
  assert.equal((await call('POST', `/hospital/visits/${visit.body.id}/complete`, docA)).status, 409, 'not their visit')
  assert.equal((await call('POST', `/hospital/visits/${visit.body.id}/complete`, docB)).status, 200)
  assert.equal((await call('POST', `/hospital/visits/${visit.body.id}/complete`, docB)).status, 409, 'already completed')
  const v2 = await call('POST', '/hospital/visits', deskB, { patientId: scan.patientId, doctorId: mehta.id, reason: 'Wrong patient picked' })
  assert.equal((await call('POST', `/hospital/visits/${v2.body.id}/cancel`, deskB)).status, 200)
  assert.equal((await call('POST', `/hospital/visits/${v2.body.id}/cancel`, deskB)).status, 404)

  // the patient revokes ONE doctor: that doctor is locked out, the hospital's other staff keep their access
  const v3 = await call('POST', '/hospital/visits', deskB, { patientId: scan.patientId, doctorId: mehta.id, reason: 'Second opinion' })
  assert.equal(v3.status, 201)
  assert.equal((await call('POST', `/patient/doctors/${crypto.randomUUID()}/revoke`, patient)).status, 404, 'only doctors the patient has been sent to')
  assert.equal((await call('POST', `/patient/doctors/${mehta.id}/revoke`, patient)).status, 200)
  assert.equal((await call('GET', '/patient/visits', patient)).body[0].status, 'CANCELLED', 'revoking ends the visit')
  assert.equal((await call('GET', `/hospital/patients/${scan.patientId}/records`, docB)).status, 403, 'revoked doctor is locked out')
  assert.equal((await call('GET', `/hospital/patients/${scan.patientId}/records`, deskB)).status, 200, 'reception keeps the hospital consent')
  assert.ok(!(await call('GET', '/hospital/active-patients', docB)).body.some((a: any) => a.patientId === scan.patientId), 'hidden from the revoked doctor')
  assert.ok((await call('GET', '/hospital/active-patients', deskB)).body.some((a: any) => a.patientId === scan.patientId), 'still listed for reception')
  assert.equal((await call('POST', '/hospital/visits', deskB, { patientId: scan.patientId, doctorId: mehta.id, reason: 'try again' })).status, 409, 'cannot assign a revoked doctor')
  const rvQr = (await call('POST', '/patient/qr', patient)).body.token
  assert.equal((await call('POST', '/hospital/visits/arrive', docB, { token: rvQr })).status, 403, 'revoked doctor cannot start a consultation')
  const doctorsList = (await call('GET', '/patient/doctors', patient)).body
  assert.equal(doctorsList.find((d: any) => d.id === mehta.id).revoked, true)
  assert.equal((await call('POST', `/patient/doctors/${mehta.id}/allow`, patient)).status, 200)
  assert.equal((await call('GET', `/hospital/patients/${scan.patientId}/records`, docB)).status, 200, 'allowed again')
  assert.equal((await call('POST', `/patient/doctors/${mehta.id}/allow`, patient)).status, 404, 'nothing left to allow')

  // revoke ends access immediately
  const consents = (await call('GET', '/patient/consents', patient)).body
  const active = consents.find((c: any) => !c.revokedAt && c.hospital?.startsWith('Riverside'))
  await call('POST', `/patient/consents/${active.id}/revoke`, patient)
  assert.equal((await call('GET', `/hospital/patients/${scan.patientId}/records`, deskB)).status, 403)
  assert.ok(!(await call('GET', '/hospital/active-patients', deskB)).body.some((a: any) => a.patientId === scan.patientId), 'revoked patients drop off the list')

  // access history is readable by patient with no raw PII, and audit is append-only
  const hist = (await call('GET', '/patient/access-history', patient)).body
  assert.ok(hist.some((h: any) => h.action === 'CONSENT_REVOKED'))

  // hospital can end its own access too
  const qr2 = (await call('POST', '/patient/qr', patient)).body.token
  const scan2 = (await call('POST', '/hospital/scan', deskB, { token: qr2 })).body
  const rq2 = await call('POST', '/hospital/requests', deskB, { scanId: scan2.scanId, categories: ['LAB'], reason: 'Second visit' })
  await call('POST', `/patient/requests/${rq2.body.id}/approve`, patient, { categories: ['LAB'], hours: 1 })
  assert.equal((await call('GET', `/hospital/patients/${scan2.patientId}/records`, deskB)).status, 200)
  assert.equal((await call('POST', `/hospital/patients/${scan2.patientId}/revoke`, deskB)).status, 200)
  assert.equal((await call('GET', `/hospital/patients/${scan2.patientId}/records`, deskB)).status, 403, 'hospital revoked itself')
  assert.equal((await call('POST', `/hospital/patients/${scan2.patientId}/revoke`, deskB)).status, 404, 'nothing left to revoke')

  // emergency: critical fields only, audited, patient-visible
  const em = await call('POST', '/hospital/emergency', docA, { code: 'DEMO-EMERGENCY-CARD-ASHA', reason: 'Unconscious, road accident' })
  assert.equal(em.status, 200); assert.equal(em.body.patient.bloodGroup, 'O+'); assert.equal(em.body.patient.records, undefined)
  assert.ok((await call('GET', '/patient/access-history', patient)).body.some((h: any) => h.action.startsWith('EMERGENCY_ACCESS')))
  assert.equal((await call('POST', '/hospital/emergency', docA, { code: 'not-a-real-card-code', reason: 'testing' })).status, 404)

  // deletion: only unverified records, only by whoever added them
  const up = await call('POST', '/patient/records', patient, { category: 'LAB', title: 'my own upload', recordDate: '2026-01-01' })
  assert.equal(up.status, 201)
  assert.equal((await call('DELETE', `/hospital/records/${up.body.id}`, docA)).status, 404, 'hospital cannot delete a patient upload')
  assert.equal((await call('DELETE', `/patient/records/${up.body.id}`, patient)).status, 200)
  assert.equal((await call('DELETE', `/patient/records/${up.body.id}`, patient)).status, 404, 'already gone')
  const signedRec = (await call('GET', '/patient/records', patient)).body.find((r: any) => r.status === 'VERIFIED' && r.hospital?.name.startsWith('City'))
  assert.equal((await call('DELETE', `/patient/records/${signedRec.id}`, patient)).status, 404, 'patient cannot delete hospital records')
  assert.equal((await call('DELETE', `/hospital/records/${signedRec.id}`, docA)).status, 409, 'verified records are immutable')
  // date of birth change needs the current password (it is also the recovery secret)
  const patch = (b: object) => call('PATCH', '/patient/me', patient, b)
  assert.equal((await patch({ dob: '1989-03-15' })).status, 403, 'no password')
  assert.equal((await patch({ dob: '1989-03-15', currentPassword: 'wrong-password' })).status, 403, 'wrong password')
  assert.equal((await patch({ dob: '2999-01-01', currentPassword: 'demo1234' })).status, 400, 'future date')
  assert.equal((await patch({ dob: '1989-03-15', currentPassword: 'demo1234' })).body.dob.slice(0, 10), '1989-03-15')
  assert.equal((await patch({ dob: '1989-03-14', currentPassword: 'demo1234' })).body.dob.slice(0, 10), '1989-03-14', 'restored')
  assert.equal((await patch({ dob: '1989-03-14', phone: '+91 98000 11111' })).status, 200, 'unchanged dob needs no password')

  // forgot password: needs the right date of birth, locks after repeated wrong guesses
  const mk = async () => {
    const email = `reset${Date.now()}${Math.random().toString(16).slice(2, 6)}@example.test`
    const r = await call('POST', '/auth/patient/register', undefined, { email, password: 'oldpassword1', firstName: 'Re', lastName: 'Set', dob: '1990-04-05', gender: 'Other', phone: '12345' })
    assert.equal(r.status, 201); return email
  }
  const e1 = await mk()
  const reset = (email: string, dob: string, pw = 'newpassword1') => call('POST', '/auth/patient/reset-password', undefined, { email, dob, newPassword: pw })
  assert.equal((await reset(e1, '1990-04-06')).status, 400, 'wrong date of birth')
  assert.equal((await reset('nobody@example.test', '1990-04-05')).body.error, (await reset(e1, '1990-04-06')).body.error, 'same answer for unknown email')
  assert.equal((await call('POST', '/auth/patient/reset-password', undefined, { email: e1, dob: '1990-04-05', newPassword: 'short' })).status, 400, 'weak password')
  assert.equal((await reset(e1, '1990-04-05')).status, 200)
  assert.equal((await call('POST', '/auth/patient/login', undefined, { email: e1, password: 'oldpassword1' })).status, 401, 'old password dead')
  assert.equal((await call('POST', '/auth/patient/login', undefined, { email: e1, password: 'newpassword1' })).status, 200)
  const e2 = await mk()
  for (let i = 0; i < 5; i++) await reset(e2, '2000-01-01')
  assert.equal((await reset(e2, '1990-04-05')).status, 429, 'locked after repeated failures, even with the right date')

  await call('DELETE', '/patient/me/photo', patient) // leave the demo patient as we found it
  srv.close()
})
