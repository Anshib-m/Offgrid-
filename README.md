# Offgrid

Patient-controlled medical record ecosystem. Hackathon prototype.

- **Patient app** (PWA, mobile-first): `http://localhost:5173/`
- **Hospital portal** (web): `http://localhost:5173/hospital/`
- **API**: Express + TypeScript + Prisma on `:4000`
- **DB**: PostgreSQL. Only the API touches it.

## Run

```bash
npm install
npm run db        # terminal 1: embedded Postgres on :5433 (no Docker needed). Or point DATABASE_URL at any Postgres.
npm run migrate   # terminal 2: apply migrations
npm run seed      # demo data
npm run server    # API :4000
npm run web       # both frontends :5173
npm test          # end-to-end consent/verification test (needs seed)
```

Copy `server/.env.example` to `server/.env` first. Change every secret outside local dev.

## Demo accounts (password `demo1234`)

| Who | Login |
|---|---|
| Patient Asha | `asha@example.test` (patient app) |
| Hospital A doctor / desk | `dr.rao@citygeneral.test` / `desk@citygeneral.test` |
| Hospital B doctor / desk | `dr.mehta@riverside.test` / `desk@riverside.test` |
| Emergency card code | `DEMO-EMERGENCY-CARD-ASHA` (hospital portal → Emergency) |

Seeded history lives at Hospital A: signed surgery, lab, medication, discharge, an unrelated dermatology consult, one **unverified** patient-uploaded blood test, and a follow-up on 20 Nov 2026.

## Demo script (two browser tabs: patient on a phone-sized window, hospital on desktop)

1. Patient → Home → **Show my QR**.
2. Hospital B desk → Patient desk → paste the code → sees **name and age only**.
3. Access tab → request Surgery, Lab, Medication from "City General only", purpose "Pre-operative review".
4. Patient app buzzes live → Requests → untick Lab → **Approve** (1 hour).
5. Hospital B → Records: only Surgery + Medication, only from Hospital A. Consult and Lab hidden.
6. Hospital B adds a record → UNVERIFIED → Dr. Mehta **Verify & sign**.
7. Dr. Rao (Hospital A) → Discharge with prescription and follow-up → patient gets reminder + signed records.
8. Patient → Me → **Revoke** → Hospital B reload → 🔒 locked. Access history lists every event.
9. Hospital → Emergency → card code + reason → critical fields only, patient notified.

## Rules the backend enforces

- QR holds an opaque one-time nonce (5 min). No patient ID or data inside.
- Scan before request. Pre-consent view is name + age.
- Read path: valid, unexpired, unrevoked consent **and** category match **and** source-hospital match. A hospital always sees records it authored itself.
- Patient can narrow a request, never widen it. Revoke is immediate.
- Records are UNVERIFIED until a doctor signs. Doctors only verify their own hospital's records, or patient uploads they may read. Verified records are immutable (DB trigger).
- Signature: Ed25519 over a hash of record content and file hashes. Edit anything after signing and the UI shows `signature invalid`.
- Audit log: append-only (DB trigger), keyed by `HMAC-SHA256(patientId, pepper)`, with a transaction ID. This is **pseudonymization**, not anonymization: anyone with the pepper can re-link. Rotate/KMS the pepper in production.
- Clinical notes encrypted at rest (AES-256-GCM). Passwords bcrypt. All input validated with zod. SQL only through Prisma (parameterized).
- Emergency: critical fields only, 1 hour grant, patient notified, always audited. Family code uses the same mechanism as the card.

## Simulated for the hackathon (needs real infrastructure in production)

| Here | Production |
|---|---|
| Doctor signing keys in the DB (encrypted) | HSM/KMS, doctor identity proofing, medical council registry lookup |
| Hospital onboarding via seed | Verified hospital registration and licensing |
| QR via browser camera or pasted text; NFC not wired | NFC tag/card issuance and secure element |
| Files on local disk (`server/uploads`), not encrypted | Encrypted object storage (S3/GCS) with virus scanning |
| SSE in memory, one API instance | Message broker, native push (FCM/APNs) |
| Desk registration records a 24h consent as "patient present" | Identity verification at the desk |
| Family member = a second emergency code | Verified delegate accounts with their own approval flow |
| TLS not set up locally | TLS everywhere, WAF, rate limiting, lockout, MFA |
| JWT in `sessionStorage`; SSE token in query string | HttpOnly cookies, short-lived tokens, refresh rotation |
| Desk-created patients get a one-time password with no change screen | Forced reset / invite link |
| Regulatory compliance (HIPAA, GDPR, DPDP Act, ABDM) | Legal review, DPIA, breach process |

## Native patient app (Expo / React Native)

`mobile/` is a native iOS/Android version of the patient PWA. It talks to the same API. `web/` and `server/` are unchanged.

```bash
cd mobile
cp .env.example .env   # set EXPO_PUBLIC_API_URL to http://<your computer's LAN IP>:4000 for a real phone
npm start              # scan the QR with Expo Go; phone and computer on the same Wi-Fi
```

Same screens as the PWA: QR identity, approve/narrow/deny requests, records (verified vs unverified), upload, follow-ups, consents/revoke, emergency cards, access history. Differences: polls every 5s instead of SSE (add FCM/APNs for background push), token in the device keychain via `expo-secure-store`, and "Add family member" uses `Alert.prompt` which is iOS-only.

## Flutter patient app (Android)

`patient_flutter/` is the same patient app in Flutter. It uses the same API.

```bash
cd patient_flutter
flutter pub get
flutter run                                              # Android emulator (reaches the API at 10.0.2.2:4000)
flutter run --dart-define=API_URL=http://<LAN IP>:4000   # real phone, same Wi-Fi
flutter build apk                                        # installable APK
```

Needs the Android SDK (install Android Studio, then `flutter doctor --android-licenses`). Android is the only target generated. Polls every 5s (add FCM for background push). Cleartext HTTP is enabled for local dev; turn it off and use HTTPS in production.

iOS: `patient_flutter/` also has an iOS target. Needs Xcode, an iOS Simulator runtime (`xcodebuild -downloadPlatform iOS`) and CocoaPods (`brew install cocoapods`). Then `flutter run -d "iPhone 18 Pro"`. The iOS simulator reaches the API at `localhost:4000` (set automatically).
