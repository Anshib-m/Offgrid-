import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { z } from 'zod'
import { Category } from '@prisma/client'
import { audit, auditThrottled, emit, enc, HttpError, prisma, sha256, subscribe } from '../core.js'
import { auth, me, parse } from '../auth.js'
import { activeConsents, canSeeProfile, denyBlockedDoctor, expireStale, isDoctorBlocked, readableWhere, requireConsent } from '../consent.js'
import { deleteUnverified, recordInclude, shape, verifyInTx } from '../records.js'
import { docData, docPath, upload } from '../upload.js'

export const hospitalRouter = Router()
const hid = (req: Parameters<typeof me>[0]) => me(req).hospitalId!
const AnyCategory = z.enum(Object.values(Category) as [string, ...string[]])
const RecordCategory = AnyCategory.refine(c => c !== 'PROFILE', 'not a record category')
const pid = (req: { params: Record<string, unknown> }) => String(req.params.patientId)

hospitalRouter.get('/events', auth(['DOCTOR', 'STAFF'], true), (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }).flushHeaders()
  res.write(': ok\n\n')
  subscribe(`hospital:${hid(req)}`, res)
})

hospitalRouter.use(auth(['DOCTOR', 'STAFF']))

// Every route that names a patient first checks the patient has not revoked this doctor.
hospitalRouter.param('patientId', async (req, _res, next, id) => {
  try { if (/^[0-9a-f-]{36}$/i.test(String(id))) await denyBlockedDoctor(me(req), String(id)); next() } catch (e) { next(e) }
})

hospitalRouter.get('/me', async (req, res) => {
  const s = await prisma.staff.findUniqueOrThrow({ where: { id: me(req).id }, select: { id: true, fullName: true, role: true, specialty: true, availability: true, hospital: { select: { id: true, name: true } } } })
  res.json(s)
})

hospitalRouter.get('/hospitals', async (req, res) => {
  res.json(await prisma.hospital.findMany({ where: { id: { not: hid(req) } }, select: { id: true, name: true } }))
})

// ---- identity: QR scan and desk registration
hospitalRouter.post('/scan', async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body)
  const used = await prisma.identityToken.updateMany({ where: { nonce: token, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } })
  if (used.count !== 1) throw new HttpError(410, 'QR invalid, expired or already used')
  const { patient } = await prisma.identityToken.findUniqueOrThrow({ where: { nonce: token }, include: { patient: true } })
  const scan = await prisma.scan.create({ data: { patientId: patient.id, hospitalId: hid(req), staffId: me(req).id } })
  await audit(patient.id, { hospitalId: hid(req), staffId: me(req).id, action: 'QR_SCANNED', purpose: 'patient identification' })
  // Before consent: name and age only.
  res.json({ scanId: scan.id, patientId: patient.id, name: `${patient.firstName} ${patient.lastName}`, age: Math.floor((Date.now() - patient.dob.getTime()) / 31_557_600_000) })
})

// Patient present at the desk: account created, 24h consent recorded as desk-registration.
hospitalRouter.post('/patients', async (req, res) => {
  const b = parse(z.object({ email: z.string().email(), firstName: z.string().min(1), lastName: z.string().min(1), dob: z.coerce.date(), gender: z.enum(['Male', 'Female', 'Other']), phone: z.string().min(5) }), req.body)
  const tempPassword = randomBytes(6).toString('base64url')
  const hospitalId = hid(req)
  const out = await prisma.$transaction(async tx => {
    if (await tx.patient.findUnique({ where: { email: b.email } })) throw new HttpError(409, 'email already registered')
    const p = await tx.patient.create({ data: { ...b, passwordHash: await bcrypt.hash(tempPassword, 10) } })
    const scan = await tx.scan.create({ data: { patientId: p.id, hospitalId, staffId: me(req).id } })
    const r = await tx.accessRequest.create({
      data: { patientId: p.id, requestingHospitalId: hospitalId, requestedBy: me(req).id, categories: Object.values(Category), reason: 'Desk registration, patient present', status: 'APPROVED', expiresAt: new Date() },
    })
    await tx.consent.create({ data: { patientId: p.id, hospitalId, requestId: r.id, categories: Object.values(Category), expiresAt: new Date(Date.now() + 24 * 3_600_000) } })
    await audit(p.id, { hospitalId, staffId: me(req).id, action: 'PATIENT_REGISTERED', purpose: 'desk registration' }, tx)
    return { patientId: p.id, scanId: scan.id }
  })
  res.status(201).json({ ...out, tempPassword })
})

// ---- access requests
hospitalRouter.post('/requests', async (req, res) => {
  const b = parse(z.object({
    scanId: z.string().uuid().optional(), patientId: z.string().uuid().optional(),
    categories: z.array(AnyCategory).min(1), reason: z.string().min(3).max(500), sourceHospitalId: z.string().uuid().optional(),
  }), req.body)
  // Proof of presence: a recent QR scan, or a patient who already has active access with this hospital.
  const scan = b.scanId ? await prisma.scan.findFirst({ where: { id: b.scanId, hospitalId: hid(req), createdAt: { gt: new Date(Date.now() - 60 * 60_000) } } }) : null
  const patientId = scan?.patientId ?? b.patientId
  if (!patientId || (b.scanId && !scan && !b.patientId)) throw new HttpError(403, 'scan the patient QR first (scans last 60 min)')
  await denyBlockedDoctor(me(req), patientId)
  if (!scan && !(await activeConsents(patientId, hid(req))).length) throw new HttpError(403, 'scan the patient QR first (scans last 60 min)')
  if (b.sourceHospitalId) {
    if (b.sourceHospitalId === hid(req) || !(await prisma.hospital.findUnique({ where: { id: b.sourceHospitalId } }))) throw new HttpError(400, 'bad source hospital')
  }
  const r = await prisma.accessRequest.create({
    data: { patientId, requestingHospitalId: hid(req), sourceHospitalId: b.sourceHospitalId, requestedBy: me(req).id, categories: b.categories as Category[], reason: b.reason, expiresAt: new Date(Date.now() + 60 * 60_000) },
  })
  await audit(patientId, { hospitalId: hid(req), staffId: me(req).id, action: 'ACCESS_REQUESTED', purpose: b.reason })
  emit(`patient:${patientId}`, 'request', { id: r.id })
  res.status(201).json(r)
})

// A hospital can end its own access at any time (e.g. patient left, case closed).
hospitalRouter.post('/patients/:patientId/revoke', async (req, res) => {
  const patientId = pid(req), hospitalId = hid(req)
  const consents = await activeConsents(patientId, hospitalId)
  if (!consents.length) throw new HttpError(404, 'no active access to revoke')
  await prisma.$transaction(async tx => {
    await tx.consent.updateMany({ where: { id: { in: consents.map(c => c.id) } }, data: { revokedAt: new Date() } })
    await tx.accessRequest.updateMany({ where: { id: { in: consents.map(c => c.requestId) } }, data: { status: 'REVOKED' } })
    await audit(patientId, { hospitalId, staffId: me(req).id, action: 'ACCESS_RELINQUISHED', purpose: 'hospital ended its access' }, tx)
  })
  emit(`patient:${patientId}`, 'consents', {})
  res.json({ ok: true })
})

// Patients whose consent to this hospital is neither revoked nor expired.
hospitalRouter.get('/active-patients', async (req, res) => {
  const myBlocks = me(req).role === 'DOCTOR' ? (await prisma.doctorBlock.findMany({ where: { doctorId: me(req).id }, select: { patientId: true } })).map(b => b.patientId) : []
  const consents = await prisma.consent.findMany({ where: { hospitalId: hid(req), revokedAt: null, expiresAt: { gt: new Date() }, patientId: { notIn: myBlocks } }, orderBy: { grantedAt: 'desc' } })
  const patients = await prisma.patient.findMany({
    where: { id: { in: [...new Set(consents.map(c => c.patientId))] } },
    select: { id: true, firstName: true, lastName: true, dob: true, photoRef: true },
  })
  const hospitals = new Map((await prisma.hospital.findMany({ select: { id: true, name: true } })).map(h => [h.id, h.name]))
  res.json(patients.map(p => {
    const mine = consents.filter(c => c.patientId === p.id)
    return {
      patientId: p.id, name: `${p.firstName} ${p.lastName}`,
      age: Math.floor((Date.now() - p.dob.getTime()) / 31_557_600_000),
      categories: [...new Set(mine.flatMap(c => c.categories))],
      sources: [...new Set(mine.map(c => c.sourceHospitalId && hospitals.get(c.sourceHospitalId)).filter(Boolean))],
      grantedAt: mine[0].grantedAt,
      expiresAt: new Date(Math.max(...mine.map(c => +c.expiresAt))),
      hasPhoto: !!p.photoRef && canSeeProfile(mine),
    }
  }).sort((a, b) => +new Date(b.grantedAt) - +new Date(a.grantedAt)))
})

hospitalRouter.get('/requests', async (req, res) => {
  await expireStale()
  res.json(await prisma.accessRequest.findMany({
    where: { requestingHospitalId: hid(req) }, orderBy: { createdAt: 'desc' }, take: 50,
    include: { sourceHospital: { select: { name: true } }, consent: { select: { categories: true, expiresAt: true, revokedAt: true } } },
  }))
})

// ---- reading records: always through consent
hospitalRouter.get('/patients/:patientId/records', async (req, res) => {
  const patientId = pid(req), hospitalId = hid(req)
  let consents
  try { consents = await requireConsent(patientId, hospitalId) } catch (e) {
    await auditThrottled(patientId, { hospitalId, staffId: me(req).id, action: 'ACCESS_DENIED', purpose: 'no valid consent' })
    throw e
  }
  const rows = (await prisma.medicalRecord.findMany({ where: readableWhere(patientId, hospitalId, consents), include: recordInclude, orderBy: { recordDate: 'desc' } })).map(shape)
  const profile = canSeeProfile(consents)
    ? await prisma.patient.findUniqueOrThrow({ where: { id: patientId }, select: { firstName: true, lastName: true, dob: true, gender: true, phone: true, email: true, bloodGroup: true, allergies: true, chronicConditions: true, emergencyContactName: true, emergencyContactPhone: true, photoRef: true } })
    : null
  await auditThrottled(patientId, { hospitalId, staffId: me(req).id, action: 'RECORDS_READ', purpose: 'clinical care' })
  res.json({
    profile: profile && (({ photoRef, ...rest }) => ({ ...rest, hasPhoto: !!photoRef }))(profile),
    consents: consents.map(c => ({ categories: c.categories, sourceHospitalId: c.sourceHospitalId, expiresAt: c.expiresAt })),
    verified: rows.filter(r => r.status === 'VERIFIED'),
    unverified: rows.filter(r => r.status === 'UNVERIFIED'),
  })
})

// Profile photo: only with a consent that includes personal info (PROFILE).
hospitalRouter.get('/patients/:patientId/photo', async (req, res) => {
  const consents = await requireConsent(pid(req), hid(req))
  if (!canSeeProfile(consents)) throw new HttpError(403, 'patient has not shared personal info')
  const p = await prisma.patient.findUnique({ where: { id: pid(req) }, select: { photoRef: true, photoType: true } })
  if (!p?.photoRef) throw new HttpError(404, 'no photo')
  await auditThrottled(pid(req), { hospitalId: hid(req), staffId: me(req).id, action: 'PHOTO_READ', purpose: 'patient identification' })
  res.type(p.photoType ?? 'image/jpeg'); createReadStream(docPath(p.photoRef)).pipe(res)
})

hospitalRouter.get('/documents/:id', async (req, res) => {
  const d = await prisma.medicalDocument.findUnique({ where: { id: String(req.params.id) } })
  if (!d) throw new HttpError(404, 'not found')
  await denyBlockedDoctor(me(req), d.patientId)
  const consents = await activeConsents(d.patientId, hid(req))
  const ok = await prisma.medicalRecord.findFirst({ where: { AND: [{ id: d.recordId }, readableWhere(d.patientId, hid(req), consents)] }, select: { id: true } })
  if (!ok) throw new HttpError(403, 'not authorized')
  await audit(d.patientId, { hospitalId: hid(req), staffId: me(req).id, action: 'DOCUMENT_READ', purpose: 'clinical care' })
  res.type(d.fileType); createReadStream(docPath(d.fileRef)).pipe(res)
})

// ---- writing records
hospitalRouter.post('/patients/:patientId/records', upload, async (req, res) => {
  const patientId = pid(req)
  await requireConsent(patientId, hid(req))
  const b = parse(z.object({ category: RecordCategory, title: z.string().min(1).max(200), notes: z.string().max(5000).optional(), recordDate: z.coerce.date() }), req.body)
  const r = await prisma.medicalRecord.create({
    data: {
      patientId, source: 'HOSPITAL', hospitalId: hid(req), createdById: me(req).id, category: b.category as Category, title: b.title,
      notesEnc: b.notes ? enc(b.notes) : null, recordDate: b.recordDate,
      documents: req.file ? { create: { patientId, ...docData(req.file) } } : undefined,
    },
    include: recordInclude,
  })
  await audit(patientId, { hospitalId: hid(req), staffId: me(req).id, action: 'RECORD_CREATED', purpose: b.category })
  emit(`patient:${patientId}`, 'records', {})
  res.status(201).json(shape(r))
})

// Own hospital's unverified records only; the author or any doctor of that hospital may delete.
hospitalRouter.delete('/records/:id', async (req, res) => {
  const u = me(req)
  const pre = await prisma.medicalRecord.findFirst({ where: { id: String(req.params.id) }, select: { patientId: true } })
  if (pre) await denyBlockedDoctor(u, pre.patientId)
  const rec = await deleteUnverified({
    id: String(req.params.id), hospitalId: hid(req), source: 'HOSPITAL',
    ...(u.role === 'DOCTOR' ? {} : { createdById: u.id }),
  })
  await audit(rec.patientId, { hospitalId: hid(req), staffId: u.id, action: 'RECORD_DELETED', purpose: rec.category })
  emit(`patient:${rec.patientId}`, 'records', {})
  res.json({ ok: true })
})

hospitalRouter.post('/records/:id/documents', upload, async (req, res) => {
  if (!req.file) throw new HttpError(400, 'file required')
  const rec = await prisma.medicalRecord.findFirst({ where: { id: String(req.params.id), hospitalId: hid(req), status: 'UNVERIFIED' } })
  if (!rec) throw new HttpError(404, 'unverified record of this hospital not found')
  await denyBlockedDoctor(me(req), rec.patientId)
  await requireConsent(rec.patientId, hid(req))
  await prisma.medicalDocument.create({ data: { recordId: rec.id, patientId: rec.patientId, ...docData(req.file) } })
  res.status(201).json({ ok: true })
})

// ---- verification: doctors only; own hospital's records, or patient uploads they may read
hospitalRouter.post('/records/:id/verify', auth(['DOCTOR']), async (req, res) => {
  const id = String(req.params.id)
  const rec = await prisma.medicalRecord.findUnique({ where: { id } })
  if (!rec) throw new HttpError(404, 'not found')
  await denyBlockedDoctor(me(req), rec.patientId)
  if (rec.hospitalId !== hid(req)) {
    const consents = await activeConsents(rec.patientId, hid(req))
    const readable = rec.source === 'PATIENT_UPLOAD' && await prisma.medicalRecord.findFirst({ where: { AND: [{ id }, readableWhere(rec.patientId, hid(req), consents)] }, select: { id: true } })
    if (!readable) throw new HttpError(403, 'cannot verify another hospital\'s record')
  }
  const doctor = await prisma.staff.findUniqueOrThrow({ where: { id: me(req).id }, select: { id: true, signingKeyEnc: true } })
  await prisma.$transaction(async tx => {
    await verifyInTx(tx, id, doctor)
    await audit(rec.patientId, { hospitalId: hid(req), staffId: doctor.id, action: 'RECORD_VERIFIED', purpose: rec.category }, tx)
  })
  emit(`patient:${rec.patientId}`, 'records', {})
  res.json(shape(await prisma.medicalRecord.findUniqueOrThrow({ where: { id }, include: recordInclude })))
})

// ---- discharge: one transaction, doctor-signed
hospitalRouter.post('/patients/:patientId/discharge', auth(['DOCTOR']), async (req, res) => {
  const patientId = pid(req), hospitalId = hid(req)
  await requireConsent(patientId, hospitalId)
  const b = parse(z.object({
    dischargeDate: z.coerce.date(), title: z.string().min(1).max(200).default('Discharge summary'), instructions: z.string().min(1).max(5000),
    prescription: z.object({ title: z.string().min(1).max(200), notes: z.string().max(2000) }).optional(),
    followUp: z.object({ date: z.coerce.date(), reason: z.string().min(1).max(300), instructions: z.string().max(1000).optional() }).optional(),
  }), req.body)
  const doctor = await prisma.staff.findUniqueOrThrow({ where: { id: me(req).id }, select: { id: true, signingKeyEnc: true } })
  const mk = (category: Category, title: string, notes: string, tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) =>
    tx.medicalRecord.create({ data: { patientId, source: 'HOSPITAL', hospitalId, createdById: doctor.id, category, title, notesEnc: enc(notes), recordDate: b.dischargeDate } })
  const out = await prisma.$transaction(async tx => {
    const rec = await mk('DISCHARGE', b.title, b.instructions, tx)
    await verifyInTx(tx, rec.id, doctor)
    let rx
    if (b.prescription) { rx = await mk('MEDICATION', b.prescription.title, b.prescription.notes, tx); await verifyInTx(tx, rx.id, doctor) }
    const d = await tx.dischargeRecord.create({ data: { patientId, hospitalId, recordId: rec.id, prescriptionId: rx?.id, dischargeDate: b.dischargeDate, instructions: b.instructions, followUpNeeded: !!b.followUp } })
    if (b.followUp) await tx.followUpReminder.create({ data: { patientId, hospitalId, doctorId: doctor.id, dischargeId: d.id, followUpDate: b.followUp.date, reason: b.followUp.reason, instructions: b.followUp.instructions } })
    await audit(patientId, { hospitalId, staffId: doctor.id, action: 'DISCHARGED', purpose: 'discharge' }, tx)
    return d
  })
  emit(`patient:${patientId}`, 'records', {})
  emit(`patient:${patientId}`, 'reminders', {})
  res.status(201).json(out)
})

// ---- follow-ups
hospitalRouter.get('/patients/:patientId/follow-ups', async (req, res) => {
  res.json(await prisma.followUpReminder.findMany({ where: { patientId: pid(req), hospitalId: hid(req) }, orderBy: { followUpDate: 'asc' } }))
})

hospitalRouter.post('/patients/:patientId/follow-ups', async (req, res) => {
  const patientId = pid(req)
  await requireConsent(patientId, hid(req))
  const b = parse(z.object({ date: z.coerce.date(), reason: z.string().min(1).max(300), instructions: z.string().max(1000).optional() }), req.body)
  const r = await prisma.followUpReminder.create({ data: { patientId, hospitalId: hid(req), doctorId: me(req).role === 'DOCTOR' ? me(req).id : undefined, followUpDate: b.date, reason: b.reason, instructions: b.instructions } })
  await audit(patientId, { hospitalId: hid(req), staffId: me(req).id, action: 'FOLLOWUP_CREATED', purpose: b.reason })
  emit(`patient:${patientId}`, 'reminders', {})
  res.status(201).json(r)
})

hospitalRouter.patch('/follow-ups/:id', async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['COMPLETED', 'CANCELLED']) }), req.body)
  const r = await prisma.followUpReminder.updateMany({ where: { id: String(req.params.id), hospitalId: hid(req) }, data: { status } })
  if (!r.count) throw new HttpError(404, 'not found')
  res.json({ ok: true })
})

// A hospital can remove a follow-up it created (e.g. entered by mistake). Other hospitals cannot touch it.
hospitalRouter.delete('/follow-ups/:id', async (req, res) => {
  const r = await prisma.followUpReminder.findFirst({ where: { id: String(req.params.id), hospitalId: hid(req) } })
  if (!r) throw new HttpError(404, 'follow-up not found')
  await prisma.followUpReminder.delete({ where: { id: r.id } })
  await audit(r.patientId, { hospitalId: hid(req), staffId: me(req).id, action: 'FOLLOWUP_DELETED', purpose: r.reason })
  emit(`patient:${r.patientId}`, 'reminders', {})
  res.json({ ok: true })
})

// ---- doctors, availability and visit assignments
const ACTIVE = ['WAITING', 'IN_CONSULT'] as const
const visitInclude = { patient: { select: { id: true, firstName: true, lastName: true, dob: true } }, doctor: { select: { id: true, fullName: true, specialty: true } } }
type VisitRow = Awaited<ReturnType<typeof prisma.visit.findFirstOrThrow<{ include: typeof visitInclude }>>>
const ageOf = (d: Date) => Math.floor((Date.now() - d.getTime()) / 31_557_600_000)
const shapeVisit = (v: VisitRow) => ({
  id: v.id, status: v.status, reason: v.reason, createdAt: v.createdAt, arrivedAt: v.arrivedAt, completedAt: v.completedAt,
  patient: { id: v.patient.id, name: `${v.patient.firstName} ${v.patient.lastName}`, age: ageOf(v.patient.dob) },
  doctor: { id: v.doctor.id, name: v.doctor.fullName, specialty: v.doctor.specialty },
})
const visitEvents = (hospitalId: string, patientId: string) => { emit(`patient:${patientId}`, 'visit', {}); emit(`hospital:${hospitalId}`, 'visit', {}) }

hospitalRouter.get('/doctors', async (req, res) => {
  const docs = await prisma.staff.findMany({ where: { hospitalId: hid(req), role: 'DOCTOR' }, select: { id: true, fullName: true, specialty: true, availability: true }, orderBy: { fullName: 'asc' } })
  const load = await prisma.visit.groupBy({ by: ['doctorId'], where: { hospitalId: hid(req), status: { in: [...ACTIVE] } }, _count: true })
  res.json(docs.map(d => ({ ...d, activeVisits: load.find(l => l.doctorId === d.id)?._count ?? 0 })))
})

hospitalRouter.patch('/me/availability', auth(['DOCTOR']), async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['AVAILABLE', 'BUSY', 'OFF_DUTY']) }), req.body)
  await prisma.staff.update({ where: { id: me(req).id }, data: { availability: status } })
  emit(`hospital:${hid(req)}`, 'visit', {})
  res.json({ availability: status })
})

// Reception (or a doctor) assigns an available doctor to a patient the hospital already knows.
hospitalRouter.post('/visits', async (req, res) => {
  const b = parse(z.object({ patientId: z.string().uuid(), doctorId: z.string().uuid(), reason: z.string().trim().min(3).max(300) }), req.body)
  const hospitalId = hid(req)
  const known = (await activeConsents(b.patientId, hospitalId)).length > 0
    || !!(await prisma.scan.findFirst({ where: { patientId: b.patientId, hospitalId, createdAt: { gt: new Date(Date.now() - 60 * 60_000) } }, select: { id: true } }))
  if (!known) throw new HttpError(403, 'scan the patient QR or get their approval first')
  const doc = await prisma.staff.findFirst({ where: { id: b.doctorId, hospitalId, role: 'DOCTOR' } })
  if (!doc) throw new HttpError(404, 'doctor not found')
  if (await isDoctorBlocked(b.patientId, doc.id)) throw new HttpError(409, `the patient has revoked access for ${doc.fullName}`)
  if (doc.availability !== 'AVAILABLE') throw new HttpError(409, `${doc.fullName} is not available right now`)
  const dup = await prisma.visit.findFirst({ where: { patientId: b.patientId, hospitalId, status: { in: [...ACTIVE] } }, include: { doctor: { select: { fullName: true } } } })
  if (dup) throw new HttpError(409, `patient already has an active visit with ${dup.doctor.fullName}`)
  const v = await prisma.visit.create({ data: { hospitalId, patientId: b.patientId, doctorId: doc.id, assignedById: me(req).id, reason: b.reason }, include: visitInclude })
  await audit(b.patientId, { hospitalId, staffId: me(req).id, action: 'VISIT_ASSIGNED', purpose: b.reason })
  visitEvents(hospitalId, b.patientId)
  res.status(201).json(shapeVisit(v))
})

// Queue: active visits plus anything finished in the last 24 hours. ?mine=1 limits to the signed-in doctor.
hospitalRouter.get('/visits', async (req, res) => {
  const since = new Date(Date.now() - 24 * 3_600_000)
  const hidden = me(req).role === 'DOCTOR' ? (await prisma.doctorBlock.findMany({ where: { doctorId: me(req).id }, select: { patientId: true } })).map(b => b.patientId) : []
  const rows = await prisma.visit.findMany({
    where: {
      hospitalId: hid(req), patientId: { notIn: hidden }, ...(req.query.mine ? { doctorId: me(req).id } : {}),
      OR: [{ status: { in: [...ACTIVE] } }, { createdAt: { gt: since } }],
    },
    include: visitInclude, orderBy: { createdAt: 'asc' },
  })
  res.json(rows.map(shapeVisit))
})

hospitalRouter.patch('/visits/:id', async (req, res) => {
  const { doctorId } = parse(z.object({ doctorId: z.string().uuid() }), req.body)
  const v = await prisma.visit.findFirst({ where: { id: String(req.params.id), hospitalId: hid(req), status: 'WAITING' } })
  if (!v) throw new HttpError(404, 'waiting visit not found')
  const doc = await prisma.staff.findFirst({ where: { id: doctorId, hospitalId: hid(req), role: 'DOCTOR' } })
  if (!doc) throw new HttpError(404, 'doctor not found')
  if (await isDoctorBlocked(v.patientId, doc.id)) throw new HttpError(409, `the patient has revoked access for ${doc.fullName}`)
  if (doc.availability !== 'AVAILABLE') throw new HttpError(409, `${doc.fullName} is not available right now`)
  const upd = await prisma.visit.update({ where: { id: v.id }, data: { doctorId: doc.id, assignedById: me(req).id }, include: visitInclude })
  await audit(v.patientId, { hospitalId: hid(req), staffId: me(req).id, action: 'VISIT_REASSIGNED', purpose: v.reason })
  visitEvents(hid(req), v.patientId)
  res.json(shapeVisit(upd))
})

hospitalRouter.post('/visits/:id/cancel', async (req, res) => {
  const v = await prisma.visit.findFirst({ where: { id: String(req.params.id), hospitalId: hid(req), status: 'WAITING' } })
  if (!v) throw new HttpError(404, 'waiting visit not found')
  await prisma.visit.update({ where: { id: v.id }, data: { status: 'CANCELLED', completedAt: new Date() } })
  await audit(v.patientId, { hospitalId: hid(req), staffId: me(req).id, action: 'VISIT_CANCELLED', purpose: v.reason })
  visitEvents(hid(req), v.patientId)
  res.json({ ok: true })
})

// Arrival: the assigned doctor scans the patient's QR again. Starts the consultation and opens the patient's file.
hospitalRouter.post('/visits/arrive', auth(['DOCTOR']), async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body)
  const hospitalId = hid(req), doctorId = me(req).id
  const idt = await prisma.identityToken.findFirst({ where: { nonce: token, usedAt: null, expiresAt: { gt: new Date() } }, include: { patient: true } })
  if (!idt) throw new HttpError(410, 'QR invalid, expired or already used')
  await denyBlockedDoctor(me(req), idt.patientId)
  // The QR is only spent when it matches a visit assigned to this doctor.
  const visit = await prisma.visit.findFirst({ where: { patientId: idt.patientId, hospitalId, doctorId, status: { in: [...ACTIVE] } }, orderBy: { createdAt: 'desc' } })
  if (!visit) throw new HttpError(403, 'This patient is not assigned to you')
  const spent = await prisma.identityToken.updateMany({ where: { nonce: token, usedAt: null }, data: { usedAt: new Date() } })
  if (spent.count !== 1) throw new HttpError(410, 'QR invalid, expired or already used')
  const out = await prisma.$transaction(async tx => {
    const v = await tx.visit.update({ where: { id: visit.id }, data: { status: 'IN_CONSULT', arrivedAt: visit.arrivedAt ?? new Date() }, include: visitInclude })
    const scan = await tx.scan.create({ data: { patientId: idt.patientId, hospitalId, staffId: doctorId } })
    await audit(idt.patientId, { hospitalId, staffId: doctorId, action: 'QR_SCANNED', purpose: 'consultation arrival' }, tx)
    if (visit.status === 'WAITING') await audit(idt.patientId, { hospitalId, staffId: doctorId, action: 'VISIT_STARTED', purpose: visit.reason }, tx)
    return { v, scan }
  })
  visitEvents(hospitalId, idt.patientId)
  res.json({ scanId: out.scan.id, patientId: idt.patientId, name: `${idt.patient.firstName} ${idt.patient.lastName}`, age: ageOf(idt.patient.dob), visit: shapeVisit(out.v) })
})

hospitalRouter.post('/visits/:id/complete', auth(['DOCTOR']), async (req, res) => {
  const v = await prisma.visit.findFirst({ where: { id: String(req.params.id), hospitalId: hid(req), doctorId: me(req).id, status: 'IN_CONSULT' } })
  if (!v) throw new HttpError(409, 'only your in-progress visits can be completed')
  await prisma.visit.update({ where: { id: v.id }, data: { status: 'COMPLETED', completedAt: new Date() } })
  await audit(v.patientId, { hospitalId: hid(req), staffId: me(req).id, action: 'VISIT_COMPLETED', purpose: v.reason })
  visitEvents(hid(req), v.patientId)
  res.json({ ok: true })
})

// ---- emergency: critical fields only, 1h grant, patient notified, always audited
const critical = (p: { firstName: string; lastName: string; dob: Date; bloodGroup: string | null; allergies: string | null; chronicConditions: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null }) =>
  ({ name: `${p.firstName} ${p.lastName}`, dob: p.dob, bloodGroup: p.bloodGroup, allergies: p.allergies, chronicConditions: p.chronicConditions, emergencyContactName: p.emergencyContactName, emergencyContactPhone: p.emergencyContactPhone })

hospitalRouter.post('/emergency', async (req, res) => {
  const b = parse(z.object({ code: z.string().min(10).max(100), reason: z.string().min(5).max(300) }), req.body)
  const card = await prisma.emergencyCard.findFirst({ where: { code: sha256(b.code), revokedAt: null }, include: { patient: true } })
  if (!card) throw new HttpError(404, 'invalid or revoked emergency card')
  const grant = await prisma.emergencyGrant.create({ data: { patientId: card.patientId, hospitalId: hid(req), staffId: me(req).id, cardId: card.id, reason: b.reason, expiresAt: new Date(Date.now() + 3_600_000) } })
  await audit(card.patientId, { hospitalId: hid(req), staffId: me(req).id, action: `EMERGENCY_ACCESS_${card.kind}`, purpose: b.reason })
  emit(`patient:${card.patientId}`, 'emergency', {})
  res.json({ grantId: grant.id, expiresAt: grant.expiresAt, patient: critical(card.patient) })
})

hospitalRouter.get('/emergency/:grantId', async (req, res) => {
  const g = await prisma.emergencyGrant.findFirst({ where: { id: String(req.params.grantId), hospitalId: hid(req), expiresAt: { gt: new Date() } } })
  if (!g) throw new HttpError(403, 'emergency grant expired or not yours')
  res.json({ grantId: g.id, expiresAt: g.expiresAt, patient: critical(await prisma.patient.findUniqueOrThrow({ where: { id: g.patientId } })) })
})

// ---- hospital's own audit trail: pseudonymous refs only
hospitalRouter.get('/audit', async (req, res) => {
  const logs = await prisma.auditLog.findMany({ where: { hospitalId: hid(req) }, orderBy: { createdAt: 'desc' }, take: 100 })
  res.json(logs.map(l => ({ txId: l.txId, patientRef: l.patientRef.slice(0, 12), action: l.action, purpose: l.purpose, at: l.createdAt, staffId: l.staffId })))
})
