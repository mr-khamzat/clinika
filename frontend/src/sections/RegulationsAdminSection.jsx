// ============================================================
// RegulationsAdminSection — список SOP/регламентов с CRUD-таблицей.
// Доступ: franchise_owner, super_admin.
// Колонки: Название · Категория · Статус (chip) · Версия · Роли · Создан · Действия.
// Верх: поиск, фильтр по категории, фильтр по статусу, кнопка «+ Новый регламент».
// Переход в конструктор: window.location.search = ?id=<id> или ?id=new
// (integration-агент свяжет роутер; мы используем search-param контракт).
//
// Lazy-load: импорт через React.lazy в App.jsx (делает integration-агент).
// ============================================================
import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import api from '../api'
import { useToast, useConfirm } from '../design'
import './regulations.css'

// Тяжёлый модал статистики — подгружаем по требованию.
const CompletionsModal = lazy(() => import('../components/regulations/CompletionsModal'))
// Конструктор регламента — отдельный экран, ленивая загрузка.
// Открывается при ?reg=<id> или ?reg=new. Возврат: setBuilderId(null) + history.
const RegulationBuilderSection = lazy(() => import('./RegulationBuilderSection'))

// Преднастройка категорий (синхрон с builder’ом).
const CATEGORIES = [
  '',                 // «все»
  'Регистратура',
  'Врачи',
  'Менеджмент',
  'Финансы',
  'Маркетинг',
  'Технические',
  'Качество',
  'HR',
  'Прочее',
]

const STATUSES = [
  { v: '',          l: 'Все статусы' },
  { v: 'draft',     l: 'Черновики' },
  { v: 'published', l: 'Опубликованные' },
  { v: 'archived',  l: 'Архив' },
]

function StatusChip({ status }) {
  const label = status === 'published' ? 'Опубликован'
    : status === 'archived' ? 'Архив'
    : 'Черновик'
  return <span className={`reg-chip reg-chip-${status || 'draft'}`}>{label}</span>
}

function fmtDate(s) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    if (isNaN(d.getTime())) return s
    return d.toLocaleDateString('ru-RU')
  } catch { return s }
}

// Утилита: id регламента из URL (?reg=...). Возвращает строку id или null.
function readBuilderIdFromUrl() {
  if (typeof window === 'undefined') return null
  try {
    const u = new URL(window.location.href)
    const v = u.searchParams.get('reg')
    return v ? String(v) : null
  } catch { return null }
}

export default function RegulationsAdminSection() {
  const { toast } = useToast()
  const { confirm, ConfirmHost } = useConfirm()

  // ── Состояние «открыт конструктор?» ───────────────────────────────
  // builderId === null  → показываем таблицу
  // builderId === 'new' → создаём новый регламент в конструкторе
  // builderId === <uuid> → редактируем существующий
  const [builderId, setBuilderId] = useState(() => readBuilderIdFromUrl())

  // Синхронизация с popstate (back/forward в браузере)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onPop = () => setBuilderId(readBuilderIdFromUrl())
    window.addEventListener('popstate', onPop)
    // Слушаем кастомное событие (для обратной совместимости с openBuilder)
    const onOpen = (ev) => {
      const id = ev?.detail?.id
      setBuilderId(id ? String(id) : 'new')
    }
    window.addEventListener('regulations:open-builder', onOpen)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('regulations:open-builder', onOpen)
    }
  }, [])

  // Закрыть конструктор: убрать ?reg= и вернуться к таблице
  const closeBuilder = () => {
    try {
      const u = new URL(window.location.href)
      u.searchParams.delete('reg')
      window.history.replaceState({}, '', u.toString())
    } catch {}
    setBuilderId(null)
    // Чтобы список обновился (если что-то создали/изменили)
    setOffset(0)
  }

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  // Фильтры
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const [offset, setOffset] = useState(0)
  const limit = 20

  // Модал статистики
  const [statsFor, setStatsFor] = useState(null) // {id, current_version}

  // ── Загрузка списка ───────────────────────────────────────
  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (category) params.set('category', category)
      if (status) params.set('status', status)
      params.set('limit', String(limit))
      params.set('offset', String(offset))
      const r = await api.get('/admin/regulations?' + params.toString())
      setItems(r.data?.items || [])
      setTotal(r.data?.total ?? (r.data?.items?.length || 0))
    } catch (e) {
      toast('Не удалось загрузить регламенты: ' + (e?.response?.data?.detail || e.message), 'error')
      setItems([])
      setTotal(0)
    }
    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [category, status, offset])
  // Поиск — с debounce
  useEffect(() => {
    const t = setTimeout(() => { setOffset(0); load() }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  // ── Переход в конструктор ────────────────────────────────
  //   ?reg=<id>  → редактирование существующего
  //   ?reg=new   → новый регламент
  // Внутренний state переключает рендер: список ↔ RegulationBuilderSection.
  function openBuilder(id) {
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('reg', id ? String(id) : 'new')
      window.history.pushState({}, '', url.toString())
    } catch {}
    setBuilderId(id ? String(id) : 'new')
  }

  // ── Архивирование (мягкое удаление) ──────────────────────
  async function archive(item) {
    if (!(await confirm(`Архивировать "${item.title}"?`, { danger: true, okText: 'Архивировать' }))) return
    try {
      await api.delete(`/admin/regulations/${item.id}`)
      toast('Регламент перенесён в архив', 'success')
      load()
    } catch (e) {
      toast('Ошибка: ' + (e?.response?.data?.detail || e.message), 'error')
    }
  }

  // ── Открыть статистику завершений ────────────────────────
  function openStats(item) {
    setStatsFor({ id: item.id, current_version: item.current_version || null })
  }

  // ── Пагинация ────────────────────────────────────────────
  const page = Math.floor(offset / limit) + 1
  const pages = Math.max(1, Math.ceil(total / limit))

  // ── Категории для фильтра ────────────────────────────────
  const categoryOptions = useMemo(() => CATEGORIES, [])

  // Если открыт конструктор — рендерим Builder вместо таблицы.
  // Builder сам управляет ?reg=<newId> после успешного POST.
  if (builderId) {
    return (
      <Suspense fallback={<div style={{ padding: 24, color: '#9ca3af' }}>Загрузка конструктора…</div>}>
        <div style={{ padding: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <button
              className="reg-tool-btn"
              onClick={closeBuilder}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
              К списку регламентов
            </button>
          </div>
          <RegulationBuilderSection
            regulationId={builderId === 'new' ? null : builderId}
            onBack={closeBuilder}
          />
        </div>
      </Suspense>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      {ConfirmHost}

      {/* Заголовок */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1f2937' }}>
            Регламенты
          </h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
            SOP, чек-листы и инструкции для сотрудников. Версионирование и статистика прочтения.
          </p>
        </div>
        <button className="reg-tool-btn reg-ai" onClick={() => openBuilder(null)}>
          <span className="material-symbols-outlined">add</span>
          Новый регламент
        </button>
      </div>

      {/* Фильтры */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 220 }}>
          <span className="material-symbols-outlined" style={{
            position: 'absolute', left: 10, top: 9, color: '#9ca3af', fontSize: 18,
          }}>search</span>
          <input
            className="reg-input"
            style={{ paddingLeft: 34 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по названию…"
          />
        </div>
        <select className="reg-select" style={{ maxWidth: 200 }} value={category} onChange={(e) => { setOffset(0); setCategory(e.target.value) }}>
          <option value="">Все категории</option>
          {categoryOptions.filter(Boolean).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="reg-select" style={{ maxWidth: 200 }} value={status} onChange={(e) => { setOffset(0); setStatus(e.target.value) }}>
          {STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
        </select>
      </div>

      {/* Таблица */}
      <div style={{
        background: '#fff',
        border: '1px solid #ececec',
        borderRadius: 14,
        overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: 16 }}>
            {[0,1,2,3].map(i => (
              <div key={i} className="reg-skel" style={{ height: 36, marginBottom: 8 }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center', color: '#9ca3af' }}>
            <div className="material-symbols-outlined" style={{ fontSize: 36, marginBottom: 6 }}>menu_book</div>
            <div>Регламентов пока нет.</div>
            <button className="reg-tool-btn reg-ai" style={{ marginTop: 12 }} onClick={() => openBuilder(null)}>
              <span className="material-symbols-outlined">add</span>
              Создать первый
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="reg-table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Категория</th>
                  <th>Статус</th>
                  <th>Версия</th>
                  <th>Роли</th>
                  <th>Создан</th>
                  <th style={{ width: 1 }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: '#1f2937' }}>{it.title || 'Без названия'}</div>
                      {it.published_at && (
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>
                          Опубликован {fmtDate(it.published_at)}
                        </div>
                      )}
                    </td>
                    <td>{it.category || '—'}</td>
                    <td><StatusChip status={it.status} /></td>
                    <td>{it.current_version ? `v${it.current_version}` : '—'}</td>
                    <td>{it.assigned_roles_count ?? 0}</td>
                    <td>{fmtDate(it.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="reg-icon-btn" title="Редактировать" onClick={() => openBuilder(it.id)}>
                          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                        </button>
                        <button className="reg-icon-btn" title="Кто выполнил" onClick={() => openStats(it)}>
                          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>fact_check</span>
                        </button>
                        {it.status !== 'archived' && (
                          <button className="reg-icon-btn danger" title="Архивировать" onClick={() => archive(it)}>
                            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>archive</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Пагинация */}
        {total > limit && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 14px',
            borderTop: '1px solid #f0f0f0',
            fontSize: 13,
            color: '#6b7280',
          }}>
            <div>Страница {page} из {pages}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="reg-tool-btn"
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0}
              >Назад</button>
              <button
                className="reg-tool-btn"
                onClick={() => setOffset(offset + limit)}
                disabled={offset + limit >= total}
              >Вперёд</button>
            </div>
          </div>
        )}
      </div>

      {/* Модал статистики */}
      {statsFor && (
        <Suspense fallback={null}>
          <CompletionsModal
            open
            regulationId={statsFor.id}
            currentVersion={statsFor.current_version}
            onClose={() => setStatsFor(null)}
          />
        </Suspense>
      )}
    </div>
  )
}
