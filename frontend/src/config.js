/**
 * Динамическое определение slug тенанта из URL.
 *
 * клиниксеть.рф/           → лендинг (SLUG='', API_BASE='/api')
 * клиниксеть.рф/arc/       → тенант arc (API_BASE='/arc/api')
 * клиниксеть.рф/imed/admin → тенант imed (API_BASE='/imed/api')
 *
 * После логина на лендинге — редирект на /{tenant_slug}/admin от бэкенда.
 */
const _parts = window.location.pathname.split('/').filter(Boolean)

// Slug — первый сегмент пути. Пустой на корне сайта.
export const SLUG = _parts[0] || ''

// Базовый путь для Router (пустой на лендинге)
export const BASE_PATH = SLUG ? `/${SLUG}` : ''

// API base: на корне используем /api/, в тенантах /{slug}/api/
export const API_BASE = SLUG ? `/${SLUG}/api` : '/api'
