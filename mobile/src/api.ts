import * as SecureStore from 'expo-secure-store'

// Simulator: http://localhost:4000. Physical phone: your computer's LAN IP.
export const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000'
let token: string | null = null
export const loadToken = async () => (token = await SecureStore.getItemAsync('og_token'))
export const saveToken = async (t: string | null) => {
  token = t
  t ? await SecureStore.setItemAsync('og_token', t) : await SecureStore.deleteItemAsync('og_token')
}

export class AuthError extends Error {}
export async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const form = body instanceof FormData
  const r = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { ...(body && !form ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: form ? (body as FormData) : body ? JSON.stringify(body) : undefined,
  })
  const data = await r.json().catch(() => null)
  if (!r.ok) {
    if (r.status === 401 && token) throw new AuthError('session expired')
    throw new Error(data?.error ?? `HTTP ${r.status}`)
  }
  return data
}
