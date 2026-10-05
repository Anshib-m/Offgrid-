// Demo data. All demo accounts use the password below. Never run against real data.
import bcrypt from 'bcryptjs'
import { Category } from '@prisma/client'
import { enc, newSigningKeys, prisma, sha256 } from './core.js'
import { verifyInTx } from './records.js'

const PASSWORD = 'demo1234'
const CARD_CODE = 'DEMO-EMERGENCY-CARD-ASHA'
const days = (n: number) => new Date(Date.now() + n * 86_400_000)

const passwordHash = await bcrypt.hash(PASSWORD, 10)

// Third demo hospital. Idempotent, so `npm run seed` also adds it to a database that is already seeded.
async function ensureLakeside() {
  const h = await prisma.hospital.upsert({
    where: { licenseNumber: 'HOSP-C-003' }, update: {},
    create: { name: 'Lakeside Community Hospital', licenseNumber: 'HOSP-C-003', address: '5 Lake View Road', contactEmail: 'admin@lakeside.test' },
  })
  const people = [
    { role: 'STAFF' as const, fullName: 'Divya (Reception)', email: 'desk@lakeside.test', extra: {} },
    { role: 'DOCTOR' as const, fullName: 'Dr. Arun Nair', email: 'dr.nair@lakeside.test', extra: { licenseNumber: 'MED-3001', specialty: 'Internal Medicine', ...newSigningKeys() } },
  ]
  for (const p of people) {
    if (await prisma.staff.findUnique({ where: { email: p.email } })) continue
    await prisma.staff.create({ data: { hospitalId: h.id, role: p.role, fullName: p.fullName, email: p.email, passwordHash, ...p.extra } })
  }
}

if (await prisma.hospital.count()) {
  await ensureLakeside()
  console.log('already seeded. Ensured Lakeside Community Hospital: desk@lakeside.test, dr.nair@lakeside.test (password demo1234)')
  await prisma.$disconnect()
  process.exit(0)
}

const A = await prisma.hospital.create({ data: { name: 'City General Hospital', licenseNumber: 'HOSP-A-001', address: '12 Park Road', contactEmail: 'admin@citygeneral.test' } })
const B = await prisma.hospital.create({ data: { name: 'Riverside Medical Centre', licenseNumber: 'HOSP-B-002', address: '88 River Street', contactEmail: 'admin@riverside.test' } })
const staff = (hospitalId: string, role: 'DOCTOR' | 'STAFF', fullName: string, email: string, extra = {}) =>
  prisma.staff.create({ data: { hospitalId, role, fullName, email, passwordHash, ...extra } })
const drRao = await staff(A.id, 'DOCTOR', 'Dr. Meera Rao', 'dr.rao@citygeneral.test', { licenseNumber: 'MED-1001', specialty: 'General Surgery', ...newSigningKeys() })
await staff(A.id, 'STAFF', 'Anil (Reception)', 'desk@citygeneral.test')
await staff(B.id, 'DOCTOR', 'Dr. Karan Mehta', 'dr.mehta@riverside.test', { licenseNumber: 'MED-2001', specialty: 'Cardiology', ...newSigningKeys() })
await staff(B.id, 'STAFF', 'Priya (Reception)', 'desk@riverside.test')

const asha = await prisma.patient.create({
  data: {
    email: 'asha@example.test', passwordHash, firstName: 'Asha', lastName: 'Verma', dob: new Date('1989-03-14'), gender: 'Female', phone: '+91 98000 11111',
    bloodGroup: 'O+', allergies: 'Penicillin (severe)', chronicConditions: 'Hypertension', emergencyContactName: 'Ravi Verma', emergencyContactPhone: '+91 98000 22222',
  },
})
await prisma.emergencyCard.create({ data: { patientId: asha.id, kind: 'CARD', holderName: 'Asha Verma', code: sha256(CARD_CODE) } })

const rec = (category: Category, title: string, notes: string, ago: number) =>
  prisma.medicalRecord.create({ data: { patientId: asha.id, source: 'HOSPITAL', hospitalId: A.id, createdById: drRao.id, category, title, notesEnc: enc(notes), recordDate: days(-ago) } })
const signed = [
  await rec('SURGERY', 'Laparoscopic appendectomy', 'Uncomplicated. General anaesthesia. Discharged day 2.', 150),
  await rec('LAB', 'Complete blood count', 'Hb 13.1 g/dL, WBC 7.2, Platelets 240. Normal.', 151),
  await rec('MEDICATION', 'Amlodipine 5 mg daily', 'Continue for hypertension. Review in 3 months.', 148),
  await rec('DISCHARGE', 'Discharge summary: appendectomy', 'Wound care, no heavy lifting 4 weeks. Return if fever.', 148),
  await rec('CONSULTATION', 'Dermatology consult: eczema', 'Topical steroid, 2 weeks.', 300),
]
for (const r of signed) await prisma.$transaction(tx => verifyInTx(tx, r.id, drRao))

await prisma.medicalRecord.create({
  data: { patientId: asha.id, source: 'PATIENT_UPLOAD', category: 'LAB', title: 'Blood test (photo from local lab)', notesEnc: enc('Uploaded by patient. Not yet reviewed by a doctor.'), recordDate: days(-20) },
})
await prisma.followUpReminder.create({ data: { patientId: asha.id, hospitalId: A.id, doctorId: drRao.id, followUpDate: new Date('2026-11-20'), reason: 'Post-surgery examination', instructions: 'Bring previous reports' } })

await ensureLakeside()
console.log(`seeded. password for every account: ${PASSWORD}
patient:  asha@example.test
hospital A (City General):  dr.rao@citygeneral.test (doctor), desk@citygeneral.test (reception)
hospital B (Riverside):     dr.mehta@riverside.test (doctor), desk@riverside.test (reception)
hospital C (Lakeside):      dr.nair@lakeside.test (doctor), desk@lakeside.test (reception)
emergency card code: ${CARD_CODE}`)
await prisma.$disconnect()
