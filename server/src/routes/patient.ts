import { Router } from 'express'
import { randomBytes, createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { z } from 'zod'
import { Category } from '@prisma/client'
import { audit, enc, emit, HttpError, prisma, pseudo, subscribe } from '../core.js'
import { auth, me, parse } from '../auth.js'
import { expireStale } from '../consent.js'
import { recordInclude, shape } from '../records.js'
import { docData, docPath, upload } from '../upload.js'

export const patientRouter = Router()
const mine = auth(['PATIENT'])
const RecordCategory = z.enum(Object.values(Category) as [string, ...string[]]).refine(c => c !== 'PROFILE', 'not a record category')

patientRouter.get('/events', auth(['PATIENT'], true), (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }).flushHeaders()
  res.write(': ok\n\n')
  subscribe(`patient:${me(req).id}`, res)
})

patientRouter.use(mine)

const profileSelect = {
  id: true, email: true, firstName: true, lastName: true, dob: true, gender: true, phone: true, bloodGroup: true,
  allergies: true, chronicConditions: true, emergencyContactName: true, emergencyContactPhone: true,
} as const

patientRouter.get('/me', async (req, res) => {
  res.json(await prisma.patient.findUniqueOrThrow({ where: { id: me(req).id }, select: profileSelect }))
})

patientRouter.patch('/me', async (req, res) => {
  const b = parse(z.object({
    phone: z.string().min(5), bloodGroup: z.string().max(5).nullable(), allergies: z.string().max(500).nullable(),
    chronicConditions: z.string().max(500).nullable(), emergencyContactName: z.string().max(100).nullable(),
    emergencyContactPhone: z.string().max(20).nullable(),
  }).partial(), req.body)
  res.json(await prisma.patient.update({ where: { id: me(req).id }, data: b, select: profileSelect }))
})

// QR/NFC payload: opaque one-time nonce, 5 min. No patient data inside.
patientRouter.post('/qr', async (req, res) => {
  const t = await prisma.identityToken.create({
    data: { patientId: me(req).id, nonce: randomBytes(24).toString('base64url'), expiresAt: new Date(Date.now() + 5 * 60_000) },
  })
  res.json({ token: t.nonce, expiresAt: t.expiresAt })
})

// ---- records
patientRouter.get('/records', async (req, res) => {
  const rows = await prisma.medicalRecord.findMany({ where: { patientId: me(req).id }, include: recordInclude, orderBy: { recordDate: 'desc' } })
  res.json(rows.map(shape))
})

patientRouter.post('/records', upload, async (req, res) => {
  const b = parse(z.object({ category: RecordCategory, title: z.string().min(1).max(200), notes: z.string().max(5000).optional(), recordDate: z.coerce.date() }), req.body)
  const r = await prisma.medicalRecord.create({
    data: {
      patientId: me(req).id, source: 'PATIENT_UPLOAD', category: b.category as Category, title: b.title,
      notesEnc: b.notes ? enc(b.notes) : null, recordDate: b.recordDate,
      documents: req.file ? { create: { patientId: me(req).id, ...docData(req.file) } } : undefined,
    },
    include: recordInclude,
  })
  res.status(201).json(shape(r))
})

patientRouter.get('/documents/:id', async (req, res) => {
  const d = await prisma.medicalDocument.findFirst({ where: { id: String(req.params.id), patientId: me(req).id } })
  if (!d) throw new HttpError(404, 'not found')
  res.type(d.fileType); createReadStream(docPath(d.fileRef)).pipe(res)
})

// ---- access requests and consent
patientRouter.get('/requests', async (req, res) => {
  await expireStale()
  const rows = await prisma.accessRequest.findMany({
    where: { patientId: me(req).id }, orderBy: { createdAt: 'desc' }, take: 50,
    include: { requestingHospital: { select: { name: true } }, sourceHospital: { select: { name: true } }, consent: true },
  })
  res.json(rows)
})

patientRouter.post('/requests/:id/approve', async (req, res) => {
  const b = parse(z.object({ categories: z.array(z.enum(Object.values(Category) as [string, ...string[]])).min(1), hours: z.number().int().min(1).max(720).default(24) }), req.body)
  const id = String(req.params.id)
  const out = await prisma.$transaction(async tx => {
    const r = await tx.accessRequest.findFirst({ where: { id, patientId: me(req).id, status: 'PENDING', expiresAt: { gt: new Date() } } })
    if (!r) throw new HttpError(409, 'request not pending')
    const categories = r.categories.filter(c => b.categories.includes(c)) // can only narrow, never widen
    if (!categories.length) throw new HttpError(400, 'no requested category selected')
    await tx.accessRequest.update({ where: { id }, data: { status: 'APPROVED' } })
    const consent = await tx.consent.create({
      data: { patientId: r.patientId, hospitalId: r.requestingHospitalId, requestId: id, sourceHospitalId: r.sourceHospitalId, categories, expiresAt: new Date(Date.now() + b.hours * 3_600_000) },
    })
    await audit(r.patientId, { hospitalId: r.requestingHospitalId, action: 'CONSENT_GRANTED', purpose: r.reason }, tx)
    return { consent, hospitalId: r.requestingHospitalId }
  })
  emit(`hospital:${out.hospitalId}`, 'request-updated', { id, status: 'APPROVED' })
  res.json(out.consent)
})

patientRouter.post('/requests/:id/deny', async (req, res) => {
  const id = String(req.params.id)
  const r = await prisma.accessRequest.findFirst({ where: { id, patientId: me(req).id, status: 'PENDING' } })
  if (!r) throw new HttpError(409, 'request not pending')
  await prisma.accessRequest.update({ where: { id }, data: { status: 'DENIED' } })
  await audit(r.patientId, { hospitalId: r.requestingHospitalId, action: 'CONSENT_DENIED', purpose: r.reason })
  emit(`hospital:${r.requestingHospitalId}`, 'request-updated', { id, status: 'DENIED' })
  res.json({ ok: true })
})

patientRouter.get('/consents', async (req, res) => {
  const rows = await prisma.consent.findMany({ where: { patientId: me(req).id }, orderBy: { grantedAt: 'desc' }, take: 50 })
  const names = new Map((await prisma.hospital.findMany({ select: { id: true, name: true } })).map(h => [h.id, h.name]))
  res.json(rows.map(c => ({ ...c, hospital: names.get(c.hospitalId), sourceHospital: c.sourceHospitalId && names.get(c.sourceHospitalId) })))
})

patientRouter.post('/consents/:id/revoke', async (req, res) => {
  const id = String(req.params.id)
  const c = await prisma.consent.findFirst({ where: { id, patientId: me(req).id, revokedAt: null } })
  if (!c) throw new HttpError(404, 'not found')
  await prisma.$transaction([
    prisma.consent.update({ where: { id }, data: { revokedAt: new Date() } }),
    prisma.accessRequest.update({ where: { id: c.requestId }, data: { status: 'REVOKED' } }),
  ])
  await audit(c.patientId, { hospitalId: c.hospitalId, action: 'CONSENT_REVOKED', purpose: 'patient revoked' })
  emit(`hospital:${c.hospitalId}`, 'request-updated', { id: c.requestId, status: 'REVOKED' })
  res.json({ ok: true })
})

// ---- reminders and access history
patientRouter.get('/reminders', async (req, res) => {
  await prisma.followUpReminder.updateMany({ where: { patientId: me(req).id, status: 'UPCOMING', followUpDate: { lt: new Date(new Date().toDateString()) } }, data: { status: 'MISSED' } })
  res.json(await prisma.followUpReminder.findMany({ where: { patientId: me(req).id }, orderBy: { followUpDate: 'asc' }, include: { hospital: { select: { name: true } } } }))
})

patientRouter.get('/access-history', async (req, res) => {
  const logs = await prisma.auditLog.findMany({ where: { patientRef: pseudo(me(req).id) }, orderBy: { createdAt: 'desc' }, take: 100 })
  const names = new Map((await prisma.hospital.findMany({ select: { id: true, name: true } })).map(h => [h.id, h.name]))
  res.json(logs.map(l => ({ txId: l.txId, action: l.action, purpose: l.purpose, at: l.createdAt, hospital: l.hospitalId && names.get(l.hospitalId) })))
})

// ---- emergency cards (code shown once, only its hash is stored)
patientRouter.get('/emergency-cards', async (req, res) => {
  res.json(await prisma.emergencyCard.findMany({ where: { patientId: me(req).id, revokedAt: null }, select: { id: true, kind: true, holderName: true, createdAt: true } }))
})

patientRouter.post('/emergency-cards', async (req, res) => {
  const b = parse(z.object({ kind: z.enum(['CARD', 'FAMILY']), holderName: z.string().min(1).max(100) }), req.body)
  const code = randomBytes(18).toString('base64url')
  const c = await prisma.emergencyCard.create({ data: { ...b, patientId: me(req).id, code: createHash('sha256').update(code).digest('hex') } })
  res.status(201).json({ id: c.id, code })
})

patientRouter.delete('/emergency-cards/:id', async (req, res) => {
  const r = await prisma.emergencyCard.updateMany({ where: { id: String(req.params.id), patientId: me(req).id }, data: { revokedAt: new Date() } })
  if (!r.count) throw new HttpError(404, 'not found')
  res.json({ ok: true })
})
