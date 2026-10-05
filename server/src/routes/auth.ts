import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { audit, HttpError, prisma } from '../core.js'
import { issue, parse } from '../auth.js'

export const authRouter = Router()
const login = z.object({ email: z.string().email(), password: z.string().min(1) })
const DUMMY = bcrypt.hashSync('x', 10) // equalize timing for unknown emails

authRouter.post('/patient/register', async (req, res) => {
  const b = parse(z.object({
    email: z.string().email(), password: z.string().min(8), firstName: z.string().min(1), lastName: z.string().min(1),
    dob: z.coerce.date(), gender: z.enum(['Male', 'Female', 'Other']), phone: z.string().min(5),
  }), req.body)
  const { password, ...rest } = b
  try {
    const p = await prisma.patient.create({ data: { ...rest, passwordHash: await bcrypt.hash(password, 10) } })
    res.status(201).json({ token: issue({ id: p.id, role: 'PATIENT' }) })
  } catch { throw new HttpError(409, 'email already registered') }
})

authRouter.post('/patient/login', async (req, res) => {
  const { email, password } = parse(login, req.body)
  const p = await prisma.patient.findUnique({ where: { email } })
  if (!(await bcrypt.compare(password, p?.passwordHash ?? DUMMY)) || !p) throw new HttpError(401, 'invalid credentials')
  res.json({ token: issue({ id: p.id, role: 'PATIENT' }) })
})

authRouter.post('/staff/login', async (req, res) => {
  const { email, password } = parse(login, req.body)
  const s = await prisma.staff.findUnique({ where: { email } })
  if (!(await bcrypt.compare(password, s?.passwordHash ?? DUMMY)) || !s) throw new HttpError(401, 'invalid credentials')
  res.json({ token: issue({ id: s.id, role: s.role, hospitalId: s.hospitalId }) })
})

// ---- forgot password: email + date of birth.
// A date of birth is a weak secret, so failed guesses are rate limited per email and answers never reveal
// whether the email exists. ponytail: in-memory counters (single instance); add an emailed link or OTP before production.
const attempts = new Map<string, { n: number; until: number }>()
const MAX_TRIES = 5, LOCK_MS = 15 * 60_000
const locked = (k: string) => { const a = attempts.get(k); return !!a && a.n >= MAX_TRIES && Date.now() < a.until }
const noteFailure = (k: string) => {
  const a = attempts.get(k)
  if (!a || Date.now() > a.until) attempts.set(k, { n: 1, until: Date.now() + LOCK_MS })
  else a.n++
}

authRouter.post('/patient/reset-password', async (req, res) => {
  const b = parse(z.object({
    email: z.string().email(), dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD'), newPassword: z.string().min(8).max(128),
  }), req.body)
  if (locked(b.email)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.')
  const p = await prisma.patient.findUnique({ where: { email: b.email } })
  if (!p || p.dob.toISOString().slice(0, 10) !== b.dob) {
    noteFailure(b.email)
    await bcrypt.compare('x', DUMMY) // similar timing whether or not the email exists
    throw new HttpError(400, 'Email and date of birth do not match')
  }
  attempts.delete(b.email)
  await prisma.patient.update({ where: { id: p.id }, data: { passwordHash: await bcrypt.hash(b.newPassword, 10) } })
  await audit(p.id, { action: 'PASSWORD_RESET', purpose: 'reset with date of birth' })
  res.json({ ok: true })
})
