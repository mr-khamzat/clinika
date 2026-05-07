/**
 * ========================================
 * БЛОК: useClinicScope — хук выбора клиники в селекторе аналитики
 * ========================================
 * Загружает список доступных пользователю клиник через
 *   GET /manager/clinics-accessible
 * и хранит выбранный clinic_id в localStorage (sticky при reload).
 *
 * Возврат:
 *   { clinics, selectedId, setSelectedId, isLoading, isMultiClinic, error }
 *
 *   selectedId — UUID выбранной клиники, либо '' (= «все клиники»; доступно
 *                только manager-у без user.clinic_id и franchise_owner).
 *   isMultiClinic — true если у пользователя > 1 клиники (показывать селектор).
 *
 * Ключ localStorage: clinika_selected_clinic_<SLUG>
 * ========================================
 */
import { useEffect, useState, useCallback } from 'react'
import api from '../api'
import { SLUG } from '../config'

const STORAGE_KEY = `clinika_selected_clinic_${SLUG}`

function hasAnyToken() {
  if (typeof window === 'undefined') return false
  return !!(
    localStorage.getItem('clinika_admin_token_' + SLUG) ||
    localStorage.getItem('clinika_token_' + SLUG) ||
    localStorage.getItem('clinika_admin_token_') ||
    localStorage.getItem('clinika_token') ||
    localStorage.getItem('token')
  )
}

export default function useClinicScope() {
  const [clinics, setClinics] = useState([])
  const [selectedId, setSelectedIdState] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  // Persistent setter — сохраняем выбор в localStorage
  const setSelectedId = useCallback((id) => {
    setSelectedIdState(id || '')
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id)
      else localStorage.removeItem(STORAGE_KEY)
    } catch (_) { /* приватный режим */ }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!hasAnyToken()) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    api
      .get('/manager/clinics-accessible')
      .then((r) => {
        if (cancelled) return
        const list = Array.isArray(r.data) ? r.data : []
        setClinics(list)
        // Восстанавливаем выбор из localStorage если он валиден
        let storedId = ''
        try { storedId = localStorage.getItem(STORAGE_KEY) || '' } catch (_) {}
        const validStored = storedId && list.some((c) => c.id === storedId)
        if (validStored) {
          setSelectedIdState(storedId)
        } else {
          // По умолчанию — клиника с is_default=true, иначе первая
          const def = list.find((c) => c.is_default) || list[0]
          setSelectedIdState(def ? def.id : '')
        }
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e?.response?.data?.detail || e.message || 'Ошибка загрузки клиник')
        setClinics([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  return {
    clinics,
    selectedId,
    setSelectedId,
    isLoading,
    isMultiClinic: clinics.length > 1,
    error,
  }
}
