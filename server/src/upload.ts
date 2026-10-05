import multer from 'multer'
import { mkdirSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { HttpError, sha256 } from './core.js'

export const UPLOAD_DIR = resolve('uploads') // ponytail: local disk, swap for S3/GCS keyed by fileRef
mkdirSync(UPLOAD_DIR, { recursive: true })
const OK = ['application/pdf', 'image/png', 'image/jpeg']

export const upload = multer({
  storage: multer.diskStorage({ destination: UPLOAD_DIR, filename: (_q, _f, cb) => cb(null, randomUUID()) }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_q, f, cb) => (OK.includes(f.mimetype) ? cb(null, true) : cb(new HttpError(400, 'only pdf/png/jpeg'))),
}).single('file')

export const docData = (f: Express.Multer.File) => ({
  fileRef: f.filename, fileName: f.originalname.slice(0, 200), fileType: f.mimetype, sha256: sha256(readFileSync(f.path)),
})
export const docPath = (fileRef: string) => join(UPLOAD_DIR, fileRef.replace(/[^a-f0-9-]/g, ''))
