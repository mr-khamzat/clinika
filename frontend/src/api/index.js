import axios from 'axios'
import { API_BASE, BASE_PATH, SLUG } from '../config'

// API_BASE imported from config.js

const api = axios.create({ baseURL: API_BASE })

api.interceptors.request.use(config => {
  const token = localStorage.getItem('clinika_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

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
export const getAnalytics = () => api.get('/manager/reports/analytics')

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
