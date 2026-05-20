// API-обёртка для партнёрского прайса (категории + офферы).
// Используем общий axios-инстанс из ../../api (baseURL = /<slug>/api).
import api from '../api'

export const partnerCategoriesApi = {
  list: () => api.get('/clinics/me/partner-categories').then(r => r.data),
  create: (data) => api.post('/clinics/me/partner-categories', data).then(r => r.data),
  update: (id, data) => api.patch(`/clinics/me/partner-categories/${id}`, data).then(r => r.data),
  remove: (id) => api.delete(`/clinics/me/partner-categories/${id}`),
}

export const partnerOffersApi = {
  // Свой прайс (для менеджера-владельца). По умолчанию включаем неактивные,
  // чтобы их было видно и можно было снова включить.
  listMy: (includeInactive = true) =>
    api.get('/clinics/me/partner-offers', { params: { include_inactive: includeInactive } }).then(r => r.data),
  // Чужой прайс (для франшизной видимости — Task 8).
  listForClinic: (clinicId) =>
    api.get(`/clinics/${clinicId}/partner-offers`).then(r => r.data),
  createBulk: (data) => api.post('/clinics/me/partner-offers', data).then(r => r.data),
  update: (id, data) => api.patch(`/clinics/me/partner-offers/${id}`, data).then(r => r.data),
  remove: (id) => api.delete(`/clinics/me/partner-offers/${id}`),
}
