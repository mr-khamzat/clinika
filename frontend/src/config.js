/**
 * Динамическое определение slug тенанта из URL.
 *
 * клиниксеть.рф/                → лендинг (SLUG='', API_BASE='/api')
 * клиниксеть.рф/admin           → глобальная платформа khamzat (SLUG='', API_BASE='/api')
 * клиниксеть.рф/staff-chat      → встраиваемый чат сотрудников (SLUG='', API_BASE='/api')
 * клиниксеть.рф/design-preview-2 → превью дизайна (SLUG='', API_BASE='/api')
 * клиниксеть.рф/arc/            → тенант arc (API_BASE='/arc/api')
 * клиниксеть.рф/imed/admin      → тенант imed (API_BASE='/imed/api')
 */
const _parts = window.location.pathname.split("/").filter(Boolean)

// Зарезервированные path-prefixes — НЕ тенантные slug-и, обслуживаются глобально
const ROOT_PATHS = new Set(["admin", "staff-chat", "design-preview-2", "design-preview"])

// /admin без слага тенанта — глобальная платформа (super_admin)
const IS_PLATFORM_ADMIN = _parts[0] === "admin" && _parts.length === 1
const _firstIsRoot = _parts[0] && ROOT_PATHS.has(_parts[0])

// Slug — первый сегмент пути, пустой на корне и в режимах платформы / staff-chat
export const SLUG = (IS_PLATFORM_ADMIN || _firstIsRoot) ? "" : (_parts[0] || "")

// Базовый путь для Router
export const BASE_PATH = SLUG ? `/${SLUG}` : ""

// API base
export const API_BASE = SLUG ? `/${SLUG}/api` : "/api"

// Флаг: мы в режиме глобальной платформы (/admin без слага)
export const PLATFORM_MODE = IS_PLATFORM_ADMIN
