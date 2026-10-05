# Threat model and risk register

Scope: the Offgrid prototype (patient app, hospital portal, API, PostgreSQL). Everything runs in a local, controlled environment with synthetic data. This is a design-level model written by the team. It is **not** a formal penetration test or audit.

## Assets

| Asset | Why it matters |
|---|---|
| Medical records and documents | Sensitive personal health data |
| Patient identity (QR token, profile, photo) | Identification and impersonation risk |
| Consent decisions | The authority for every read |
| Doctor signing keys and signatures | Trust that a record came from a doctor |
| Audit log | Evidence of who accessed what |
| Emergency cards | A bypass of normal consent, so must be tightly limited |

## Actors

Patient, hospital reception staff, doctor, a hospital acting outside its consent, an outside attacker, a curious insider.

## Threats and mitigations

| # | Threat | Mitigation in this prototype | Residual risk |
|---|---|---|---|
| 1 | A hospital reads records without patient permission | Every read passes the consent check: active, unexpired, unrevoked consent for that hospital, category match, source-hospital match. No consent returns 403 and is audited | A hospital that holds valid consent can copy what it sees (cannot be prevented technically) |
| 2 | Hospital over-requests data | Patient sees each request, can untick categories (narrow only, never widen) and picks a duration of 1 h, 24 h or 7 days. Hospital sees name and age only before approval | Patient may approve without reading |
| 3 | QR replay or theft | QR holds an opaque random nonce, valid 5 minutes, single use, no patient data inside. A scan is also required (or an existing active consent) before a request | Someone shoulder-surfing a live QR within 5 minutes can scan it first |
| 4 | Patient ID guessing or enumeration | IDs are random UUIDs and knowing one grants nothing. All data endpoints require a token and a consent | None known |
| 5 | Forged or altered medical record | Doctors sign a SHA-256 hash of the record content and file hashes with Ed25519. Any later change shows `signature invalid`. A database trigger blocks edits to verified records | Signing keys live encrypted in the database (simulated HSM) |
| 6 | Unverified data passed off as clinical history | Records carry an explicit UNVERIFIED or VERIFIED state and provenance (source, author, verifying doctor, date). Verified and unverified are shown separately | Users must still read the badge |
| 7 | A doctor signs another hospital's record | Server checks the doctor's hospital matches the record's hospital, or that it is a patient upload the hospital may read | Insider at the same hospital |
| 8 | Audit log tampering or re-identification | Append-only database trigger. Entries use `HMAC-SHA256(patientId, pepper)` and a transaction ID, not names. This is pseudonymization, not anonymization | Anyone with the pepper can re-link entries to a patient |
| 9 | Emergency access abused | Critical fields only (blood group, allergies, conditions, emergency contact). 1-hour grant, reason required, patient notified, always audited, cards revocable. The code is stored hashed | A lost card can be used until revoked |
| 10 | Account takeover through password reset | Reset needs email and date of birth. 5 wrong guesses lock the email for 15 minutes. Errors never reveal whether an email exists. Changing the date of birth needs the current password | **Weak.** A date of birth is guessable or public. Needs an emailed link or OTP before real use |
| 11 | Credential theft | bcrypt password hashing. JWT with 8-hour expiry sent as a Bearer header (not a cookie, so no CSRF) | Token kept in `sessionStorage`, so an XSS would expose it |
| 12 | Injection | zod validates every input at the API boundary. All SQL goes through Prisma (parameterized). React escapes output. Helmet sets security headers | Dependencies could have unknown flaws |
| 13 | Malicious file upload | Only PDF, PNG and JPEG, 5 MB limit. Stored under random names outside the web root. Served only through authorized endpoints. Profile photos must be images | No virus scanning |
| 14 | Data exposure at rest | Clinical notes encrypted with AES-256-GCM. Signing keys encrypted. Passwords hashed | Uploaded files are not encrypted. Keys come from environment variables |
| 15 | Hospital keeps a patient after discharge | Patient can revoke any time. A hospital can end its own access. Consents expire automatically | None |
| 16 | Patient is sent to or examined by the wrong doctor, or a consultation is started without the patient present | Reception assigns only an available doctor of the same hospital. A consultation starts only when that doctor scans the patient's live one-time QR. A QR for someone not assigned to the scanning doctor is refused and not spent. Every assignment, start and completion is audited | A doctor could still scan a patient who is physically elsewhere if shown the QR |
| 17 | A patient no longer trusts one specific doctor but still needs the hospital | Patient can revoke a single doctor. The doctor is refused on every route that names the patient, loses the patient from their lists, cannot be assigned or scan the patient, and any visit is cancelled. The hospital's other staff keep their access. Revoke and allow are audited | Emergency "break glass" access is still available to a revoked doctor, because it exists for life-threatening cases and is always audited and notified |
| 18 | PII leaking through logs or errors | 500 errors return a generic message. Audit log stores no names | Dev server logs may print stack traces |

## Human oversight of consequential actions

- Sharing data needs an explicit **patient approval** every time.
- A record becomes part of verified history only after a **doctor** signs it.
- Deleting is limited to unverified records the user or hospital created. Verified records cannot be deleted.
- Emergency access always notifies the patient and is reviewable in their access history.

## Assumptions

- Local, single-machine demo. No real hospital, device or network is touched.
- All names, emails, phone numbers and records are synthetic (created by `server/src/seed.ts`).
- TLS, HSM/KMS, MFA and production rate limiting are out of scope for the prototype.

## AI/ML

The product uses no AI or machine-learning models. There are no predictions to validate, and no false-positive or false-negative rates. (AI-assisted coding is disclosed in the README.)
