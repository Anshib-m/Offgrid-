# 5-minute pitch and demo script

Two files in this folder: [Offgrid-pitch.pptx](Offgrid-pitch.pptx) (editable, with speaker notes) and [Offgrid-pitch.pdf](Offgrid-pitch.pdf) (same slides, for viewing). The deck has 8 slides and takes about 5 minutes spoken.

## Option A: slides only (5:00)

| Time | Slide | Say |
|---|---|---|
| 0:00 | 1. Offgrid | We are Team Offgrid. Your medical history lives on your phone, and a hospital only sees what you approve. Cyber in Healthcare track, challenge 4. All data is synthetic. |
| 0:20 | 2. The problem | Patients repeat forms, cannot see who looked at their data, cannot tell a photo from a signed record, and cannot approve anything in an emergency. |
| 0:55 | 3. The idea | One-time QR with no data. The hospital sees name and age only, asks for specific records, and the patient approves, narrows or denies with a time limit. Revoke any time, even one doctor. Everything is logged. |
| 1:40 | 4. Signed vs unsigned | Verified means a doctor signed it. Unverified stays separate. Edit a signed record and the signature check fails. |
| 2:20 | 5. A doctor visit | Reception assigns an available doctor. The patient app shows "Your visit". On arrival the doctor scans the patient's QR, and the file opens with the reason. |
| 3:20 | 6. Security | Consent on every read, Ed25519 signatures, signed records locked by a database rule, pseudonymous audit log, encrypted notes, limited emergency access. |
| 4:00 | 7. Tested and honest | 90 automated checks pass, a fresh clone from GitHub was verified, no real data. We list what production still needs. |
| 4:40 | 8. Close | Patient approves, doctor signs, everything is logged. Open source (MIT), repo address on screen. |

## Option B: live demo instead of slides 4 to 6 (about 5:00 in total)

Set up as described in the README's [demo instructions](../../README.md#demo-instructions-about-5-minutes): one browser tab per person, patient in a phone-sized window. Use slides 1 to 3 for the first minute, then:

| Time | Show | Say |
|---|---|---|
| 1:00 | Patient app: **Show my QR**. Riverside reception: paste the code, **Identify patient** | The hospital sees only name and age. |
| 1:40 | Request Surgery, Lab, Medication from City General only. Patient app: untick Lab, **Approve** | The patient narrows the request. |
| 2:20 | Riverside: Records | Only Surgery and Medication appear. Lab and the dermatology consult stay hidden. |
| 2:50 | Dr. Mehta: **Verify & Sign Record** on an unverified record | Signed with Ed25519, with the doctor's name and date. |
| 3:30 | City General reception: **Doctors & Assignments**, assign Dr. Rao. Dr. Rao: scan the patient's QR | The consultation starts and the file opens with the reason. |
| 4:15 | Patient app: **Revoke doctor**, then Dr. Rao's screen | Revoked. That doctor is locked out, the hospital is not. |
| 4:40 | Slide 8 | Patient approves, doctor signs, everything is logged. |

Tips: each QR works once, so tap **Show my QR** again before every scan. Keep the browser zoom at 100%. Rehearse once with a timer.
