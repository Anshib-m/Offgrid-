import { PrismaClient, Prisma } from '@prisma/client'
import { createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto'
import type { Response } from 'express'
import { env } from './env.js'

export const prisma = new PrismaClient()
export type Tx = Prisma.TransactionClient

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

// ---- field encryption (AES-256-GCM) for clinical notes and signing keys
const fieldKey = createHash('sha256').update(env.FIELD_KEY).digest()
export function enc(plain: string) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', fieldKey, iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), ct].map(b => b.toString('base64')).join('.')
}
export function dec(s: string) {
  const [iv, tag, ct] = s.split('.').map(p => Buffer.from(p, 'base64'))
  const d = createDecipheriv('aes-256-gcm', fieldKey, iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
}

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')

// ---- pseudonymization: keyed HMAC, not a bare hash. Linkable only with the pepper.
export const pseudo = (patientId: string) => createHmac('sha256', env.PSEUDO_PEPPER).update(patientId).digest('hex')

// ---- doctor signing keys (Ed25519). Private key kept encrypted: simulated HSM.
export function newSigningKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    signingKeyEnc: enc(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string),
  }
}
export const signHash = (signingKeyEnc: string, hash: string) =>
  sign(null, Buffer.from(hash), createPrivateKey(dec(signingKeyEnc))).toString('base64')
export const checkSignature = (publicKeyPem: string, hash: string, sig: string) =>
  verify(null, Buffer.from(hash), createPublicKey(publicKeyPem), Buffer.from(sig, 'base64'))

// ---- audit: pseudonymous, append-only (DB trigger)
export async function audit(
  patientId: string,
  e: { hospitalId?: string; staffId?: string; action: string; purpose: string },
  db: Tx | PrismaClient = prisma,
) {
  const row = await db.auditLog.create({ data: { patientRef: pseudo(patientId), ...e } })
  return row.txId
}

// For high-frequency reads (auto-refreshing screens): one entry per patient+staff+action per window.
export async function auditThrottled(
  patientId: string,
  e: { hospitalId?: string; staffId?: string; action: string; purpose: string },
  windowMs = 5 * 60_000,
) {
  const recent = await prisma.auditLog.findFirst({
    where: { patientRef: pseudo(patientId), staffId: e.staffId, action: e.action, createdAt: { gt: new Date(Date.now() - windowMs) } },
    select: { id: true },
  })
  if (!recent) await audit(patientId, e)
}

// ---- live events (SSE). In-memory: single instance only.
const channels = new Map<string, Set<Response>>()
export function subscribe(channel: string, res: Response) {
  if (!channels.has(channel)) channels.set(channel, new Set())
  channels.get(channel)!.add(res)
  res.on('close', () => channels.get(channel)?.delete(res))
}
export function emit(channel: string, event: string, data: object = {}) {
  for (const res of channels.get(channel) ?? []) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}
