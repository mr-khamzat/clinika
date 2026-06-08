import { SLUG } from '../config'
import { create } from 'zustand'
import { userTokenKey, clearAllAuth } from '../lib/authKeys'

const useAuthStore = create((set) => ({
  token: localStorage.getItem(userTokenKey(SLUG)),
  user: null,
  setToken: (token) => {
    localStorage.setItem(userTokenKey(SLUG), token)
    set({ token })
  },
  setUser: (user) => set({ user }),
  logout: () => {
    // Полный logout: чистим ВСЕ 4 ключа (access+refresh, user+admin),
    // иначе интерсептор api/index.js молча восстановит сессию по admin/refresh.
    clearAllAuth(SLUG)
    set({ token: null, user: null })
  }
}))

export default useAuthStore
