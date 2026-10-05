import jwt from 'jsonwebtoken'
import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { env } from './env.js'
import { HttpError } from './core.js'

export type Role = 'PATIENT' | 'DOCTOR' | 'STAFF'
export type Principal = { id: string; role: Role; hospitalId?: string }
export type AuthReq = Request & { user: Principal }

export const issue = (p: Principal) => jwt.sign(p, env.JWT_SECRET, { expiresIn: '8h', algorithm: 'HS256' })

// EventSource cannot set headers, so SSE routes pass allowQuery. Token in URL is a demo shortcut.
export const auth = (roles: Role[], allowQuery = false) => (req: Request, _res: Response, next: NextFunction) => {
  const h = req.headers.authorization
  const token = h?.startsWith('Bearer ') ? h.slice(7) : allowQuery ? String(req.query.token ?? '') : ''
  try {
    const p = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as Principal
    if (!roles.includes(p.role)) throw 0
    ;(req as AuthReq).user = p
    next()
  } catch { next(new HttpError(401, 'unauthorized')) }
}

export const me = (req: Request) => (req as AuthReq).user

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data)
  if (!r.success) throw new HttpError(400, r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))
  return r.data
}
