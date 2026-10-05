import type { Category, Prisma } from '@prisma/client'
import { HttpError, prisma } from './core.js'

export const activeConsents = (patientId: string, hospitalId: string) =>
  prisma.consent.findMany({ where: { patientId, hospitalId, revokedAt: null, expiresAt: { gt: new Date() } } })

export async function requireConsent(patientId: string, hospitalId: string) {
  const c = await activeConsents(patientId, hospitalId)
  if (!c.length) throw new HttpError(403, 'no active patient consent for this hospital')
  return c
}

// Records a hospital may read: its own, plus whatever active consents cover.
// A consent with sourceHospitalId only exposes that hospital's records.
export function readableWhere(patientId: string, hospitalId: string, consents: Awaited<ReturnType<typeof activeConsents>>): Prisma.MedicalRecordWhereInput {
  return {
    patientId,
    OR: [
      { hospitalId },
      ...consents.map(c => ({
        category: { in: c.categories.filter(x => x !== 'PROFILE') as Category[] },
        ...(c.sourceHospitalId ? { hospitalId: c.sourceHospitalId } : {}),
      })),
    ],
  }
}

export const canSeeProfile = (consents: { categories: Category[] }[]) => consents.some(c => c.categories.includes('PROFILE'))

export const isDoctorBlocked = async (patientId: string, doctorId: string) =>
  !!(await prisma.doctorBlock.findUnique({ where: { patientId_doctorId: { patientId, doctorId } }, select: { id: true } }))

// A patient can revoke one doctor without cutting off the whole hospital.
export async function denyBlockedDoctor(user: { id: string; role: string }, patientId: string) {
  if (user.role === 'DOCTOR' && (await isDoctorBlocked(patientId, user.id))) throw new HttpError(403, 'The patient has revoked your access')
}

export const expireStale = () =>
  prisma.accessRequest.updateMany({ where: { status: 'PENDING', expiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' } })
