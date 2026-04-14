/**
 * Динамическое определение slug тенанта из URL.
 * arc.клиниксеть.рф  → slug = 'arc', BASE_PATH = '/arc', API_BASE = '/arc/api'
 * клиниксеть.рф/imed → slug = 'imed', BASE_PATH = '/imed', API_BASE = '/imed/api'
 *
 * Fallback 'clinika' используется только при локальной разработке без slug.
 */
const _parts = window.location.pathname.split('/').filter(Boolean)
export const SLUG = _parts[0] || 'clinika'
export const BASE_PATH = `/${SLUG}`
export const API_BASE = `/${SLUG}/api`
