import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { HttpError, prisma } from '../core.js'
import { issue, parse } from '../auth.js'

export const authRouter = Router()
const login = z.object({ email: z.string().email(), password: z.string().min(1) })
const DUMMY = bcrypt.hashSync('x', 10) // equalize timing for unknown emails

authRouter.post('/patient/register', async (req, res) => {
  const b = parse(z.object({
    email: z.string().email(), password: z.string().min(8), firstName: z.string().min(1), lastName: z.string().min(1),
    dob: z.coerce.date(), gender: z.string().min(1), phone: z.string().min(5),
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
