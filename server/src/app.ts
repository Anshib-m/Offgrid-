import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { HttpError } from './core.js'
import { authRouter } from './routes/auth.js'
import { patientRouter } from './routes/patient.js'
import { hospitalRouter } from './routes/hospital.js'

export const app = express()
app.use(helmet(), cors({ origin: /^http:\/\/localhost:\d+$/ }), express.json({ limit: '100kb' }))
app.use('/api/auth', authRouter)
app.use('/api/patient', patientRouter)
app.use('/api/hospital', hospitalRouter)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message })
  console.error(err)
  res.status(500).json({ error: 'internal error' }) // never leak internals
})
