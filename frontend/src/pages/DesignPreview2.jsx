/**
 * DesignPreview2 — превью второго бандла Claude Design.
 * Все HTML-страницы из бандла лежат в /public/design2/ — рендерим в iframe
 * с переключалкой и Open-in-new-tab.
 *
 * Мобильные (Patient Android, iOS/iPad) пока опущены по запросу пользователя.
 */
import { useState } from 'react'
import { BASE_PATH } from '../config'

const TABS = [
  { id: 'patient',   label: 'Пациент',     icon: '🧑‍⚕️', file: 'patient.html',
    note: 'Web-версия пациентского кабинета: онбординг, главный экран, запись, AI-чат, история, профиль.' },
  { id: 'doctor',    label: 'Врач',        icon: '👨‍⚕️', file: 'doctor.html',
    note: 'Кабинет врача: расписание дня, карточка пациента, протокол с диктовкой, видео, документы.' },
  { id: 'admin',     label: 'Админка',     icon: '🛠️',  file: 'admin.html',
    note: 'Платформенная админка: тенанты, биллинг, мониторинг, аудит, модули.' },
  { id: 'manager',   label: 'Управляющий', icon: '📊',  file: 'manager.html',
    note: 'Кабинет руководителя клиники: KPI, drill-down аналитика, сотрудники, расписание.' },
  { id: 'klinikset', label: 'Лендинг',     icon: '🌐',  file: 'klinikset.html',
    note: 'Главный лендинг платформы КлиникСеть.' },
]

export default function DesignPreview2() {
  const [active, setActive] = useState('patient')
  const cur = TABS.find(t => t.id === active) || TABS[0]
  const src = `${BASE_PATH}/design2/${cur.file}`

  return (
    <div style={{ minHeight:'100vh', background:'#0f172a', color:'#e2e8f0', display:'flex', flexDirection:'column' }}>
      {/* Header */}
      <header style={{ padding:'12px 16px', borderBottom:'1px solid #1e293b', background:'#020617' }}>
        <div style={{ display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:18, fontWeight:800 }}>Дизайн-превью v2</div>
            <div style={{ fontSize:12, color:'#94a3b8' }}>Второй бандл Claude Design — premium медицинская тема</div>
          </div>
          <div style={{ flex:1, minWidth:8 }} />
          <a href={src} target="_blank" rel="noopener noreferrer"
            style={{ padding:'6px 12px', borderRadius:8, background:'#3b82f6', color:'white', fontSize:12, fontWeight:700, textDecoration:'none' }}>
            Открыть в новой вкладке ↗
          </a>
        </div>
      </header>

      {/* Tabs */}
      <div style={{ display:'flex', gap:4, padding:'8px 16px', overflowX:'auto', background:'#0f172a', borderBottom:'1px solid #1e293b' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActive(t.id)}
            style={{
              padding:'8px 14px', borderRadius:8, border:'none', cursor:'pointer',
              background: active === t.id ? '#1e3a8a' : '#1e293b',
              color: active === t.id ? '#dbeafe' : '#cbd5e1',
              fontSize:13, fontWeight:600, whiteSpace:'nowrap',
              transition:'background 0.15s',
            }}>
            <span style={{ marginRight:6 }}>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* Note */}
      <div style={{ padding:'8px 16px', background:'#1e293b', fontSize:12, color:'#94a3b8' }}>
        {cur.note}
      </div>

      {/* Iframe */}
      <div style={{ flex:1, padding:16, background:'#020617' }}>
        <iframe
          key={cur.id}
          src={src}
          title={cur.label}
          style={{
            width:'100%', height:'calc(100vh - 140px)', border:'1px solid #1e293b',
            borderRadius:12, background:'white',
          }}
        />
      </div>
    </div>
  )
}
