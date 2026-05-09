import axios from 'axios'
import { API_BASE, BASE_PATH, SLUG } from '../config'

// API_BASE imported from config.js

const api = axios.create({ baseURL: API_BASE })

// ─── БЛОК: Определение активного токена ───
// В системе два независимых сторадж-ключа:
//   • clinika_token_<SLUG>        — для пациентов / партнёров (обычные роли)
//   • clinika_admin_token_<SLUG>  — для админ-панели (admin/manager/franchise_owner/super_admin)
// Текущий "активный" определяется тем, какая страница открыта (admin- или partner-панель),
// но безопаснее всего — пробовать сначала admin (если открыта /admin/...), иначе обычный.
function _isAdminPath() {
  // /admin без слага   → платформа super_admin
  // /<slug>/admin/...  → тенант-админка
  const p = window.location.pathname
  return p === '/admin' || p.startsWith('/admin/') || p.endsWith('/admin') || /\/[^/]+\/admin(\/|$)/.test(p)
}

function _getActiveTokenInfo() {
  // Возвращает { kind: 'admin'|'user', tokenKey, refreshKey, token } для текущего контекста.
  const adminKey = 'clinika_admin_token_' + SLUG
  const userKey = 'clinika_token_' + SLUG
  const adminToken = localStorage.getItem(adminKey)
  const userToken = localStorage.getItem(userKey)

  if (_isAdminPath() && adminToken) {
    return { kind: 'admin', tokenKey: adminKey, refreshKey: 'clinika_admin_refresh_token_' + SLUG, token: adminToken }
  }
  if (userToken) {
    return { kind: 'user', tokenKey: userKey, refreshKey: 'clinika_refresh_token_' + SLUG, token: userToken }
  }
  // Fallback: если нет user-токена, но есть admin (например, manager/franchise_owner на /{slug}/manager)
  if (adminToken) {
    return { kind: 'admin', tokenKey: adminKey, refreshKey: 'clinika_admin_refresh_token_' + SLUG, token: adminToken }
  }
  return { kind: 'user', tokenKey: userKey, refreshKey: 'clinika_refresh_token_' + SLUG, token: null }
}

api.interceptors.request.use(config => {
  const info = _getActiveTokenInfo()
  if (info.token) config.headers.Authorization = `Bearer ${info.token}`
  return config
})

// ─── БЛОК: Auto-refresh access токена при 401 ───
// Дедуп параллельных 401: одновременные запросы ждут ОДИН refresh.
// Кэш per-tokenKey, чтобы admin и user рефрешились независимо.
const _refreshing = {}

// ─── БЛОК: Region Lock 403 ───
// Backend возвращает HTTP 403 с detail, начинающимся на "Доступ заблокирован: вы вне разрешённого региона"
// когда франшиза работает в strict-mode и пользователь обращается из чужого региона.
// Показываем специальное модальное окно вместо общего toast'а — пользователь должен понять,
// что блокировка географическая, а не из-за прав.
const REGION_BLOCK_PREFIX = 'Доступ заблокирован: вы вне разрешённого региона'
let _regionBlockShownAt = 0

function _showRegionBlockModal(detail) {
  // Дедуп: одно сообщение в 5 секунд (несколько параллельных запросов могут получить 403)
  const now = Date.now()
  if (now - _regionBlockShownAt < 5000) return
  _regionBlockShownAt = now
  // Используем простой alert как fallback. Если в проекте есть глобальная Modal/toast система —
  // можно перехватить событие 'region-lock-blocked' через window.addEventListener.
  try {
    window.dispatchEvent(new CustomEvent('region-lock-blocked', { detail: { message: detail } }))
  } catch (_) { /* noop */ }
  // Браузерный fallback — гарантированно сработает даже без слушателя.
  setTimeout(() => {
    if (Date.now() - _regionBlockShownAt < 100) {
      // Если за это время никто не успел поднять модалку — показываем alert.
      try { alert(detail) } catch (_) {}
    }
  }, 50)
}

api.interceptors.response.use(
  r => r,
  async err => {
    const cfg = err.config
    const status = err?.response?.status

    // 403 Region Lock — показываем спец-модалку и не ретраим
    if (status === 403) {
      const detail = err?.response?.data?.detail
      if (typeof detail === 'string' && detail.startsWith(REGION_BLOCK_PREFIX)) {
        _showRegionBlockModal(detail)
        return Promise.reject(err)
      }
    }

    // 401 + нет ретрая в этом запросе + есть конфиг
    if (status === 401 && cfg && !cfg._retry) {
      cfg._retry = true
      const info = _getActiveTokenInfo()
      const refreshToken = localStorage.getItem(info.refreshKey)
      if (!refreshToken) {
        // Нет refresh — чистим access и пробрасываем 401 на login
        localStorage.removeItem(info.tokenKey)
        return Promise.reject(err)
      }

      // Запускаем ОДИН общий refresh на ключ для всех параллельных 401
      if (!_refreshing[info.tokenKey]) {
        _refreshing[info.tokenKey] = axios.post(API_BASE + '/auth/refresh', { refresh_token: refreshToken })
          .then(r => {
            const newToken = r.data.access_token
            localStorage.setItem(info.tokenKey, newToken)
            // Ротация refresh-токена (если бэк возвращает новый)
            if (r.data.refresh_token) {
              localStorage.setItem(info.refreshKey, r.data.refresh_token)
            }
            return newToken
          })
          .catch(e => {
            // Refresh expired/revoked — чистим оба токена и на login
            localStorage.removeItem(info.tokenKey)
            localStorage.removeItem(info.refreshKey)
            throw e
          })
          .finally(() => { delete _refreshing[info.tokenKey] })
      }

      try {
        const newToken = await _refreshing[info.tokenKey]
        cfg.headers = cfg.headers || {}
        cfg.headers.Authorization = `Bearer ${newToken}`
        // Повторяем оригинальный запрос с новым токеном
        return axios.request(cfg)
      } catch {
        return Promise.reject(err)
      }
    }
    return Promise.reject(err)
  }
)

export const authTelegram = (data) => api.post('/auth/telegram', data)
export const loginPassword = (username, password) => api.post('/auth/login', { username, password })
export const getMe = () => api.get('/admins/me')
export const updateMe = (data) => api.patch('/admins/me', data)
export const getBonusSummary = () => api.get('/bonuses/summary')
export const getBonuses = () => api.get('/bonuses/')
export const getClinics = () => api.get('/clinics/')
export const getServices = () => api.get('/clinics/services')
export const getClinicServices = (clinicId) => api.get(`/clinics/${clinicId}/services`)
export const createReferral = (data) => api.post('/referrals/', data)
export const getReferrals = () => api.get('/referrals/')
export const getIncomingReferrals = (status) => api.get('/referrals/incoming', status ? { params: { status } } : {})
export const getReferral = (id) => api.get(`/referrals/${id}`)
export const scanQR = (qr_data) => api.post('/referrals/scan', { qr_data })
export const confirmByCode = (short_code) => api.post('/referrals/confirm-by-code', { short_code })
export const requestCancelReferral = (id, reason) => api.post(`/referrals/${id}/cancel-request`, { reason })

export const getCancelRequests = () => api.get('/manager/cancel-requests/')
export const approveCancelRequest = (id) => api.post(`/manager/cancel-requests/${id}/approve`)
export const rejectCancelRequest = (id) => api.post(`/manager/cancel-requests/${id}/reject`)

export const getManagerSummary = (params) => api.get('/manager/reports/summary', { params })
export const getManagerAdmins = (params) => api.get('/manager/reports/admins', { params })
export const getManagerClinics = () => api.get('/manager/reports/clinics')
export const getManagerReferrals = (params) => api.get('/manager/reports/referrals', { params })
export const getManagerBonuses = (params) => api.get('/manager/reports/bonuses', { params })
export const markAllPaid = (adminId) => api.post(`/manager/bonuses/mark-paid-all/${adminId}`)
export const markBonusPaid = (bonusId) => api.patch(`/manager/bonuses/${bonusId}/mark-paid`)
export const exportCSV = () => api.get('/manager/reports/export', { responseType: 'blob' })
export const assignClinic = (adminId, clinicId) => api.patch(`/manager/admins/${adminId}/assign-clinic`, { clinic_id: clinicId })

export const listAdmins = () => api.get('/admins/')
export const createAdmin = (data) => api.post('/manager/admins/', data)
export const updateAdmin = (id, data) => api.patch(`/manager/admins/${id}`, data)
export const deactivateAdmin = (id) => api.delete(`/manager/admins/${id}`)
export const listManagerClinics = () => api.get('/manager/clinics/')
export const createClinic = (data) => api.post('/manager/clinics/', data)
export const updateClinic = (id, data) => api.patch(`/manager/clinics/${id}`, data)

// Analytics
export const getDailyReport = () => api.get('/manager/reports/daily')
export const getAnalytics = (clinicId) => api.get('/manager/reports/analytics', clinicId ? { params: { clinic_id: clinicId } } : {})

// KPI
export const getKpi = (month) => api.get('/manager/kpi/', { params: month ? { month } : {} })
export const setKpi = (adminId, data) => api.post(`/manager/kpi/${adminId}`, data)

// Activity log
export const getActivityLog = (params) => api.get('/manager/activity/', { params })

// Settings
export const getGeneralSettings = () => api.get('/manager/settings/general')
export const updateGeneralSettings = (data) => api.patch('/manager/settings/general', data)
export const testMisConnection = () => api.post('/manager/settings/test-mis')

// Manager services
export const listManagerServices = () => api.get('/manager/services/')
export const updateService = (id, data) => api.patch(`/manager/services/${id}`, data)
export const createService = (data) => api.post("/manager/services/", data)
export const deleteService = (id) => api.delete(`/manager/services/${id}`)

// ─── БЛОК: Партнёры ───
export const listPartners = () => api.get('/manager/partners/')
export const updatePartner = (id, data) => api.patch(`/manager/partners/${id}`, data)
export const deletePartner = (id, hard = false) => api.delete(`/manager/partners/${id}?hard=${hard}`)

// ─── БЛОК: Инвайты ───
export const listInvitations = () => api.get('/manager/invitations/')
export const createInvitation = (data) => api.post('/manager/invitations/', data)
export const deleteInvitation = (id) => api.delete(`/manager/invitations/${id}`)

// ─── БЛОК: Регистрация по инвайту (публичные, без токена) ───
export const getInviteInfo = (code) => api.get(`/auth/invite/${code}`)
export const registerByInvite = (data) => api.post('/auth/register-invite', data)

// ─── БЛОК: Партнёр — свои услуги и направления ───
export const getMyClinicServices = (clinicId) => api.get(`/clinics/${clinicId}/services`)

// ─── БЛОК: МИС интеграция ───
export const syncMisServices = (clinicId) =>
  api.post('/manager/mis/sync-services', null, { params: clinicId ? { clinic_id: clinicId } : {} })
export const verifyPatientInMis = (phone) =>
  api.get('/referrals/verify-patient', { params: { phone } })

// ─── БЛОК: Управление услугами (категории) ───
export const getServiceCategories = (clinicId) =>
  api.get('/manager/services/categories', { params: clinicId ? { clinic_id: clinicId } : {} })
export const getServicesByCategory = (clinicId, category, extra = {}) =>
  api.get('/manager/services/', { params: { clinic_id: clinicId, category, ...extra } })
export const setCategoryBonus = (category, bonusAmount, clinicId) =>
  api.post('/manager/services/set-category-bonus', { category, bonus_amount: bonusAmount, clinic_id: clinicId || null })

export default api
