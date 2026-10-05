import { env } from './env.js'
import { app } from './app.js'

app.listen(env.PORT, () => console.log(`api on :${env.PORT}`))
