import { SLUG } from '../config'
import { create } from 'zustand'

const useAuthStore = create((set) => ({
  token: localStorage.getItem('clinika_token_' + SLUG),
  user: null,
  setToken: (token) => {
    localStorage.setItem('clinika_token_' + SLUG, token)
    set({ token })
  },
  setUser: (user) => set({ user }),
  logout: () => {
    localStorage.removeItem('clinika_token_' + SLUG)
    set({ token: null, user: null })
  }
}))

export default useAuthStore
