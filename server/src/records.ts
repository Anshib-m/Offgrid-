import type { Prisma } from '@prisma/client'
import { checkSignature, dec, HttpError, sha256, signHash, type Tx } from './core.js'

export const recordInclude = {
  hospital: { select: { id: true, name: true } },
  createdBy: { select: { fullName: true } },
  documents: { select: { id: true, fileName: true, fileType: true, sha256: true } },
  verification: { include: { doctor: { select: { fullName: true, publicKeyPem: true, hospital: { select: { name: true } } } } } },
} satisfies Prisma.MedicalRecordInclude

type Full = Prisma.MedicalRecordGetPayload<{ include: typeof recordInclude }>

// What a doctor signs: everything clinically meaningful, including attached file hashes.
export const contentHash = (r: Full) =>
  sha256(JSON.stringify([
    r.id, r.patientId, r.hospitalId, r.category, r.title,
    r.notesEnc ? dec(r.notesEnc) : null,
    r.recordDate.toISOString().slice(0, 10),
    r.documents.map(d => d.sha256).sort(),
  ]))

export function shape(r: Full) {
  const v = r.verification
  return {
    id: r.id, category: r.category, title: r.title, recordDate: r.recordDate, status: r.status,
    notes: r.notesEnc ? dec(r.notesEnc) : null,
    source: r.source, hospital: r.hospital, author: r.createdBy?.fullName ?? null,
    documents: r.documents.map(({ id, fileName, fileType }) => ({ id, fileName, fileType })),
    verification: v && {
      doctor: v.doctor.fullName, hospital: v.doctor.hospital.name, verifiedAt: v.verifiedAt,
      // false if the record or its files changed after signing
      signatureValid: v.contentHash === contentHash(r) && checkSignature(v.doctor.publicKeyPem!, v.contentHash, v.signature),
    },
  }
}

export async function verifyInTx(tx: Tx, recordId: string, doctor: { id: string; signingKeyEnc: string | null }) {
  if (!doctor.signingKeyEnc) throw new HttpError(403, 'doctor has no signing key')
  const r = await tx.medicalRecord.findUniqueOrThrow({ where: { id: recordId }, include: recordInclude })
  const hash = contentHash(r)
  const flipped = await tx.medicalRecord.updateMany({ where: { id: recordId, status: 'UNVERIFIED' }, data: { status: 'VERIFIED' } })
  if (flipped.count !== 1) throw new HttpError(409, 'record already verified')
  await tx.recordVerification.create({ data: { recordId, doctorId: doctor.id, contentHash: hash, signature: signHash(doctor.signingKeyEnc, hash) } })
}
