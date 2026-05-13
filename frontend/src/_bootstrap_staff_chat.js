// Bootstrap: парсинг JWT из URL hash для /staff-chat ДО загрузки App.
// Должен импортироваться ПЕРВЫМ в main.jsx — чтобы localStorage был заполнен
// до того, как `useAuthStore` инициализируется (он читает localStorage в начальном
// state). Без этого MiniApp.auth-гейт выдаёт Landing вместо StaffChat.
//
// Calls Electron (1.0.26+) кладёт токены в #access_token=...&refresh_token=...
// — fragment не уходит в логи сервера; сразу очищается из адресной строки.

;(function _stage_staff_chat_token() {
  try {
    const p = window.location.pathname
    if (p !== '/staff-chat' && !p.startsWith('/staff-chat/')) return
    if (!window.location.hash || window.location.hash.length < 2) return
    const params = new URLSearchParams(window.location.hash.slice(1))
    const at = params.get('access_token')
    const rt = params.get('refresh_token')
    if (!at) return
    const _parts = p.split('/').filter(Boolean)
    const ROOT = ['admin', 'staff-chat', 'design-preview-2', 'design-preview']
    const slug = (_parts[0] && ROOT.indexOf(_parts[0]) === -1) ? _parts[0] : ''
    localStorage.setItem('clinika_admin_token_' + slug, at)
    localStorage.setItem('clinika_token_' + slug, at)
    if (rt) {
      localStorage.setItem('clinika_admin_refresh_token_' + slug, rt)
      localStorage.setItem('clinika_refresh_token_' + slug, rt)
    }
    // Чистим адресную строку — токен не должен светиться в DevTools/screenshots
    history.replaceState(null, '', p + window.location.search)
  } catch (_) { /* noop */ }
})()
