-- CreateTable
CREATE TABLE "DoctorBlock" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoctorBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DoctorBlock_doctorId_idx" ON "DoctorBlock"("doctorId");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorBlock_patientId_doctorId_key" ON "DoctorBlock"("patientId", "doctorId");

-- AddForeignKey
ALTER TABLE "DoctorBlock" ADD CONSTRAINT "DoctorBlock_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorBlock" ADD CONSTRAINT "DoctorBlock_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
