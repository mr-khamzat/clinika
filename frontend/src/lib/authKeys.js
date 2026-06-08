/**
 * ========================================
 * БЛОК: Централизованные имена ключей аутентификации в localStorage
 * ========================================
 * Единый источник правды для имён сторадж-ключей. До этого модуля имена
 * дублировались строками в store/auth.js, api/index.js и шеллах кабинетов,
 * из-за чего store.logout() удалял НЕ ТОТ токен (только clinika_token_,
 * оставляя clinika_admin_token_ + оба refresh валидными → неполный logout).
 *
 * Имена ДОЛЖНЫ 1:1 совпадать с теми, что использует api/index.js
 * (_getActiveTokenInfo):
 *   • clinika_token_<SLUG>                — access пациента / партнёра (обычные роли)
 *   • clinika_admin_token_<SLUG>          — access админ-панели (admin/manager/
 *                                           franchise_owner/super_admin)
 *   • clinika_refresh_token_<SLUG>        — refresh обычного токена
 *   • clinika_admin_refresh_token_<SLUG>  — refresh admin-токена
 *
 * Edge: для super_admin (платформа /admin) SLUG === '' → ключ
 * 'clinika_admin_token_' (с пустым суффиксом). Не теряем этот случай.
 * ========================================
 */

export const userTokenKey = (slug) => 'clinika_token_' + slug
export const adminTokenKey = (slug) => 'clinika_admin_token_' + slug
export const userRefreshKey = (slug) => 'clinika_refresh_token_' + slug
export const adminRefreshKey = (slug) => 'clinika_admin_refresh_token_' + slug

/**
 * Полный logout: удаляет ВСЕ четыре ключа для данного слага.
 * try/catch на каждый ключ (паттерн из _AccountantShell), чтобы недоступность
 * localStorage / приватный режим не прерывали очистку остальных ключей.
 * Намеренно НЕ трогает clinika_impersonation_origin и прочие настройки.
 */
export function clearAllAuth(slug) {
  for (const key of [
    userTokenKey(slug),
    adminTokenKey(slug),
    userRefreshKey(slug),
    adminRefreshKey(slug),
  ]) {
    try {
      localStorage.removeItem(key)
    } catch (_) {
      /* noop — приватный режим / недоступный storage */
    }
  }
}
