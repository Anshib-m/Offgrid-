try { process.loadEnvFile() } catch {} // .env is optional in prod
const need = (k: string) => process.env[k] ?? (() => { throw new Error(`missing env ${k}`) })()
export const env = {
  JWT_SECRET: need('JWT_SECRET'),
  PSEUDO_PEPPER: need('PSEUDO_PEPPER'),
  FIELD_KEY: need('FIELD_KEY'),
  PORT: Number(process.env.PORT ?? 4000),
}
