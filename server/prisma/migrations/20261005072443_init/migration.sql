-- CreateEnum
CREATE TYPE "Role" AS ENUM ('DOCTOR', 'STAFF');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('SURGERY', 'LAB', 'IMAGING', 'MEDICATION', 'ALLERGY', 'DIAGNOSIS', 'CONSULTATION', 'DISCHARGE', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('HOSPITAL', 'PATIENT_UPLOAD');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('UPCOMING', 'COMPLETED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CardKind" AS ENUM ('CARD', 'FAMILY');

-- CreateTable
CREATE TABLE "Hospital" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hospital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "specialty" TEXT,
    "publicKeyPem" TEXT,
    "signingKeyEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dob" DATE NOT NULL,
    "gender" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "bloodGroup" TEXT,
    "allergies" TEXT,
    "chronicConditions" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityToken" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyCard" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "kind" "CardKind" NOT NULL DEFAULT 'CARD',
    "holderName" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyGrant" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalRecord" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "source" "RecordSource" NOT NULL,
    "hospitalId" UUID,
    "createdById" UUID,
    "category" "Category" NOT NULL,
    "title" TEXT NOT NULL,
    "notesEnc" TEXT,
    "recordDate" DATE NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalDocument" (
    "id" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "fileRef" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordVerification" (
    "id" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "contentHash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRequest" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "requestingHospitalId" UUID NOT NULL,
    "sourceHospitalId" UUID,
    "requestedBy" UUID NOT NULL,
    "categories" "Category"[],
    "reason" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "sourceHospitalId" UUID,
    "categories" "Category"[],
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DischargeRecord" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "prescriptionId" UUID,
    "dischargeDate" DATE NOT NULL,
    "instructions" TEXT NOT NULL,
    "followUpNeeded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DischargeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpReminder" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "doctorId" UUID,
    "dischargeId" UUID,
    "followUpDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "instructions" TEXT,
    "status" "ReminderStatus" NOT NULL DEFAULT 'UPCOMING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "txId" UUID NOT NULL,
    "patientRef" TEXT NOT NULL,
    "hospitalId" UUID,
    "staffId" UUID,
    "action" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Hospital_licenseNumber_key" ON "Hospital"("licenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Hospital_contactEmail_key" ON "Hospital"("contactEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_email_key" ON "Staff"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_licenseNumber_key" ON "Staff"("licenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_email_key" ON "Patient"("email");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityToken_nonce_key" ON "IdentityToken"("nonce");

-- CreateIndex
CREATE INDEX "Scan_patientId_hospitalId_idx" ON "Scan"("patientId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyCard_code_key" ON "EmergencyCard"("code");

-- CreateIndex
CREATE INDEX "MedicalRecord_patientId_category_idx" ON "MedicalRecord"("patientId", "category");

-- CreateIndex
CREATE INDEX "MedicalRecord_patientId_hospitalId_idx" ON "MedicalRecord"("patientId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordVerification_recordId_key" ON "RecordVerification"("recordId");

-- CreateIndex
CREATE INDEX "AccessRequest_patientId_status_idx" ON "AccessRequest"("patientId", "status");

-- CreateIndex
CREATE INDEX "AccessRequest_requestingHospitalId_status_idx" ON "AccessRequest"("requestingHospitalId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Consent_requestId_key" ON "Consent"("requestId");

-- CreateIndex
CREATE INDEX "Consent_patientId_hospitalId_idx" ON "Consent"("patientId", "hospitalId");

-- CreateIndex
CREATE INDEX "FollowUpReminder_patientId_status_idx" ON "FollowUpReminder"("patientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_txId_key" ON "AuditLog"("txId");

-- CreateIndex
CREATE INDEX "AuditLog_patientRef_createdAt_idx" ON "AuditLog"("patientRef", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_hospitalId_createdAt_idx" ON "AuditLog"("hospitalId", "createdAt");

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityToken" ADD CONSTRAINT "IdentityToken_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyCard" ADD CONSTRAINT "EmergencyCard_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecord" ADD CONSTRAINT "MedicalRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecord" ADD CONSTRAINT "MedicalRecord_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecord" ADD CONSTRAINT "MedicalRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalDocument" ADD CONSTRAINT "MedicalDocument_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "MedicalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordVerification" ADD CONSTRAINT "RecordVerification_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "MedicalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordVerification" ADD CONSTRAINT "RecordVerification_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_requestingHospitalId_fkey" FOREIGN KEY ("requestingHospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_sourceHospitalId_fkey" FOREIGN KEY ("sourceHospitalId") REFERENCES "Hospital"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AccessRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpReminder" ADD CONSTRAINT "FollowUpReminder_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpReminder" ADD CONSTRAINT "FollowUpReminder_dischargeId_fkey" FOREIGN KEY ("dischargeId") REFERENCES "DischargeRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Audit log is append-only.
CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

-- Verified records are immutable.
CREATE FUNCTION verified_record_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'VERIFIED' THEN RAISE EXCEPTION 'verified record is immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER verified_no_update BEFORE UPDATE ON "MedicalRecord"
  FOR EACH ROW EXECUTE FUNCTION verified_record_immutable();
