-- CreateEnum
CREATE TYPE "DoctorStatus" AS ENUM ('AVAILABLE', 'BUSY', 'OFF_DUTY');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('WAITING', 'IN_CONSULT', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "availability" "DoctorStatus" NOT NULL DEFAULT 'AVAILABLE';

-- CreateTable
CREATE TABLE "Visit" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "assignedById" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "VisitStatus" NOT NULL DEFAULT 'WAITING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "arrivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Visit_hospitalId_status_idx" ON "Visit"("hospitalId", "status");

-- CreateIndex
CREATE INDEX "Visit_doctorId_status_idx" ON "Visit"("doctorId", "status");

-- CreateIndex
CREATE INDEX "Visit_patientId_status_idx" ON "Visit"("patientId", "status");

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
