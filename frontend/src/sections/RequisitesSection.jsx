/**
 * RequisitesSection — редактирование юридических реквизитов и загрузка печати тенанта.
 * Доступно managers+. Используется внутри ManagerDashboard.
 */
import { useState, useEffect, useRef } from 'react'
import { API_BASE } from '../config'

const apiFetch = (method, path, token, body) =>
  fetch(API_BASE + path, {
    method: method.toUpperCase(),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json())

const FIELDS = [
  { key: 'legal_name',    label: 'Полное юридическое наименование', span: 2, hint: 'ООО "Название"' },
  { key: 'legal_inn',     label: 'ИНН',  hint: '0000000000' },
  { key: 'legal_kpp',     label: 'КПП',  hint: '000000000' },
  { key: 'legal_ogrn',    label: 'ОГРН', hint: '0000000000000' },
  { key: 'legal_address', label: 'Юридический адрес', span: 2, hint: '123456, г. Москва, ул. ...' },
  { key: 'legal_phone',   label: 'Телефон',  hint: '+7 (900) 000-00-00' },
  { key: 'legal_email',   label: 'Email',    hint: 'info@clinic.ru' },
  { key: 'legal_bank_name',    label: 'Банк',           span: 2, hint: 'ПАО Сбербанк' },
  { key: 'legal_bank_account', label: 'Расчётный счёт', hint: '40702810000000000000' },
  { key: 'legal_bank_bik',     label: 'БИК',            hint: '044525225' },
  { key: 'legal_bank_corr',    label: 'Корр. счёт',     hint: '30101810400000000225' },
  { key: 'legal_signer_name',  label: 'Подписант (ФИО)', hint: 'Иванов Иван Иванович' },
  { key: 'legal_signer_pos',   label: 'Должность подписанта', hint: 'Генеральный директор' },
]

export default function RequisitesSection({ token }) {
  const [form, setForm] = useState({})
  const [stampUrl, setStampUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef()

  useEffect(() => {
    // Загружаем текущие реквизиты через /admins/me или /tenant/branding
    fetch(API_BASE + '/admins/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(me => {
        // me содержит user, получаем tenant
        return fetch(API_BASE + '/tenant/branding', { headers: { Authorization: `Bearer ${token}` } })
      })
      .then(r => r.json())
      .then(b => {
        // branding может содержать реквизиты если мы их туда добавим
        // пока грузим через отдельный эндпоинт
        return fetch(API_BASE + '/requisites', { headers: { Authorization: `Bearer ${token}` } })
      })
      .then(r => r.json())
      .then(d => {
        if (d && !d.detail) {
          const { stamp_url, ...rest } = d
          setForm(rest)
          setStampUrl(stamp_url)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  const save = async () => {
    setSaving(true); setMsg('')
    try {
      const r = await apiFetch('PATCH', '/clinic-invoices/requisites', token, form)
      setMsg(r.ok ? '✓ Реквизиты сохранены' : (r.detail || 'Ошибка'))
    } catch { setMsg('Ошибка сохранения') }
    setSaving(false)
  }

  const uploadStamp = async (file) => {
    if (!file) return
    setUploading(true); setMsg('')
    const fd = new FormData()
    fd.append('file', file)
    try {
      const r = await fetch(API_BASE + '/clinic-invoices/stamp/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      }).then(r => r.json())
      if (r.stamp_url) { setStampUrl(r.stamp_url); setMsg('✓ Печать загружена') }
      else setMsg(r.detail || 'Ошибка загрузки')
    } catch { setMsg('Ошибка загрузки') }
    setUploading(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-2 border-[#0A2342] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="font-bold text-xl text-gray-900 mb-1">Реквизиты организации</h2>
        <p className="text-gray-500 text-sm">Используются при формировании актов и счетов</p>
      </div>

      {msg && (
        <div className={`mb-5 px-4 py-3 rounded-xl text-sm font-medium ${msg.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {msg}
        </div>
      )}

      {/* Форма реквизитов */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
        <div className="grid grid-cols-2 gap-4">
          {FIELDS.map(f => (
            <div key={f.key} className={f.span === 2 ? 'col-span-2' : ''}>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">{f.label}</label>
              <input
                value={form[f.key] || ''}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.hint}
                className="w-full border border-gray-200 focus:border-[#0A2342] focus:ring-2 focus:ring-[#0A2342]/10 rounded-xl px-3 py-2.5 text-sm outline-none transition"
              />
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <button onClick={save} disabled={saving}
            className="px-6 py-2.5 text-white rounded-xl font-semibold text-sm transition disabled:opacity-50 flex items-center gap-2"
            style={{ background: 'linear-gradient(135deg,#0A2342,#0d4a6e)' }}>
            {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <span className="material-symbols-outlined text-base">save</span>}
            Сохранить реквизиты
          </button>
        </div>
      </div>

      {/* Загрузка печати */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="font-bold text-base text-gray-900 mb-1">Печать организации</h3>
        <p className="text-gray-500 text-xs mb-5">Изображение печати будет отображаться на актах. Формат: PNG или JPEG, рекомендуется прозрачный фон (PNG).</p>
        <div className="flex items-start gap-6">
          {/* Превью */}
          <div className="w-32 h-32 rounded-2xl border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50 flex-shrink-0 overflow-hidden">
            {stampUrl ? (
              <img src={API_BASE + stampUrl + '?t=' + Date.now()} alt="Печать" className="w-full h-full object-contain p-2" />
            ) : (
              <div className="text-center">
                <span className="material-symbols-outlined text-gray-300 text-4xl block mb-1">circle</span>
                <span className="text-xs text-gray-400">Нет печати</span>
              </div>
            )}
          </div>
          {/* Кнопки */}
          <div className="flex-1">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden"
              onChange={e => uploadStamp(e.target.files[0])} />
            <button onClick={() => fileRef.current.click()} disabled={uploading}
              className="px-5 py-2.5 bg-[#0A2342] text-white rounded-xl font-semibold text-sm mb-3 flex items-center gap-2 disabled:opacity-50 transition hover:opacity-90">
              {uploading
                ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <span className="material-symbols-outlined text-base">upload</span>}
              {uploading ? 'Загружаем...' : 'Загрузить печать'}
            </button>
            <p className="text-xs text-gray-400">Рекомендуемый размер: минимум 300×300 px.<br />PNG с прозрачным фоном — лучший вариант.</p>
            {stampUrl && (
              <button onClick={() => { setStampUrl(null); setMsg('Печать удалена') }}
                className="mt-3 text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">delete</span>Удалить печать
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
