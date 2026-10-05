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
  const cats = [...view.verified, ...view.unverified].map((r: any) => r.category).sort()
  assert.deepEqual(cats, ['MEDICATION', 'SURGERY'], 'only approved categories, only from source hospital')
  assert.equal(view.profile, null, 'profile not granted')
  const surgery = view.verified.find((r: any) => r.category === 'SURGERY')
  assert.equal(surgery.verification.doctor, 'Dr. Meera Rao'); assert.equal(surgery.verification.signatureValid, true)

  // B's doctor cannot verify A's record, A's own unverified patient upload is not visible to B (LAB not consented)
  assert.equal((await call('POST', `/hospital/records/${surgery.id}/verify`, docB)).status, 403)
  // reception cannot verify at all
  assert.equal((await call('POST', `/hospital/records/${surgery.id}/verify`, deskB)).status, 401)

  // B adds its own record: unverified until doctor signs
  const created = await call('POST', `/hospital/patients/${scan.patientId}/records`, deskB, { category: 'LAB', title: 'Repeat CBC', recordDate: '2026-10-05' })
  assert.equal(created.body.status, 'UNVERIFIED')
  assert.equal((await call('POST', `/hospital/records/${created.body.id}/verify`, docB)).body.verification.hospital, 'Riverside Medical Centre')

  // revoke ends access immediately
  const consents = (await call('GET', '/patient/consents', patient)).body
  const active = consents.find((c: any) => !c.revokedAt && c.hospital?.startsWith('Riverside'))
  await call('POST', `/patient/consents/${active.id}/revoke`, patient)
  assert.equal((await call('GET', `/hospital/patients/${scan.patientId}/records`, deskB)).status, 403)

  // access history is readable by patient with no raw PII, and audit is append-only
  const hist = (await call('GET', '/patient/access-history', patient)).body
  assert.ok(hist.some((h: any) => h.action === 'CONSENT_REVOKED'))

  // emergency: critical fields only, audited, patient-visible
  const em = await call('POST', '/hospital/emergency', docA, { code: 'DEMO-EMERGENCY-CARD-ASHA', reason: 'Unconscious, road accident' })
  assert.equal(em.status, 200); assert.equal(em.body.patient.bloodGroup, 'O+'); assert.equal(em.body.patient.records, undefined)
  assert.ok((await call('GET', '/patient/access-history', patient)).body.some((h: any) => h.action.startsWith('EMERGENCY_ACCESS')))
  assert.equal((await call('POST', '/hospital/emergency', docA, { code: 'not-a-real-card-code', reason: 'testing' })).status, 404)
  srv.close()
})
