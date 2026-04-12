import { create } from 'zustand'

const useAuthStore = create((set) => ({
  token: localStorage.getItem('clinika_token'),
  user: null,
  setToken: (token) => {
    localStorage.setItem('clinika_token', token)
    set({ token })
  },
  setUser: (user) => set({ user }),
  logout: () => {
    localStorage.removeItem('clinika_token')
    set({ token: null, user: null })
  }
}))

export default useAuthStore
