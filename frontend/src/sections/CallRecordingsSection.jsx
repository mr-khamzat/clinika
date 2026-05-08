/**
 * CallRecordingsSection — страница записей звонков (модуль call_recording, W5).
 *
 * Возможности:
 *  - Таблица записей: дата, тип сессии, участники, длительность, статус,
 *    скачивание файла, открытие транскрипта.
 *  - Поиск по тексту транскриптов (ILIKE).
 *  - Modal с full_text + summary + сегментами по таймкодам.
 *
 * Гейтинг по модулю call_recording — выполняется через require_module
 * на бекенде (HTTP 402 если модуля нет).
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import api from '../api'

const SESSION_LABEL = {
  staff:    'Штатные',
  telemed:  'Телемед',
  external: 'Внешний',
}

const STATUS_LABEL = {
  uploading:    { text: 'Загрузка',    color: '#9aa0a6' },
  ready:        { text: 'Ожидает',     color: '#f4b400' },
  transcribing: { text: 'Расшифровка', color: '#1976d2' },
  done:         { text: 'Готово',      color: '#0f9d58' },
  failed:       { text: 'Ошибка',      color: '#d93025' },
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtDuration(sec) {
  if (sec == null) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtParticipants(arr) {
  if (!Array.isArray(arr) || !arr.length) return '—'
  return arr.map(p => p.name || p.role || '?').join(', ')
}

function fmtBytes(n) {
  if (!n) return '—'
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`
  return `${(n / 1024 / 1024).toFixed(1)} МБ`
}

export default function CallRecordingsSection({ token }) {
  const [items, setItems]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState({ session_type: '', status: '' })
  const [searchQ, setSearchQ]   = useState('')
  const [hits, setHits]         = useState(null)        // null | array
  const [open, setOpen]         = useState(null)        // recording row
  const [transcript, setTranscript] = useState(null)
  const [trLoading, setTrLoading] = useState(false)
  const [error, setError]       = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = {}
    if (filter.session_type) params.session_type = filter.session_type
    if (filter.status)       params.status       = filter.status
    api.get('/recordings', { params })
      .then(r => setItems(r.data || []))
      .catch(e => {
        if (e?.response?.status === 402) {
          setError('Модуль "Запись звонков" не подключён к этому тенанту.')
        } else {
          setError('Не удалось загрузить записи.')
        }
        setItems([])
      })
      .finally(() => setLoading(false))
  }, [filter])

  useEffect(() => { load() }, [load])

  const runSearch = () => {
    if (!searchQ || searchQ.length < 2) { setHits(null); return }
    api.get('/recordings/search/transcripts', { params: { q: searchQ } })
      .then(r => setHits(r.data || []))
      .catch(() => setHits([]))
  }

  const openModal = (row) => {
    setOpen(row)
    setTranscript(null)
    if (row.has_transcript) {
      setTrLoading(true)
      api.get(`/recordings/${row.id}/transcript`)
        .then(r => setTranscript(r.data))
        .catch(() => setTranscript(null))
        .finally(() => setTrLoading(false))
    }
  }

  const downloadFile = (id) => {
    // Открываем в новой вкладке — сервер отдаёт FileResponse.
    window.open(`/api/recordings/${id}/file`, '_blank')
  }

  const removeRow = async (id) => {
    if (!window.confirm('Удалить запись и файл? Транскрипт сохранится для аудита.')) return
    try {
      await api.delete(`/recordings/${id}`)
      load()
    } catch {
      alert('Не удалось удалить запись.')
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Запись звонков</h2>

      {error && (
        <div style={{
          background: '#fce8e6', color: '#c5221f', padding: 12,
          borderRadius: 6, marginBottom: 12,
        }}>
          {error}
        </div>
      )}

      {/* ── Фильтры ──────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16,
        alignItems: 'center',
      }}>
        <select
          value={filter.session_type}
          onChange={e => setFilter(f => ({ ...f, session_type: e.target.value }))}
          style={{ padding: '6px 10px' }}
        >
          <option value="">Все типы</option>
          <option value="staff">Штатные</option>
          <option value="telemed">Телемед</option>
          <option value="external">Внешний</option>
        </select>

        <select
          value={filter.status}
          onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}
          style={{ padding: '6px 10px' }}
        >
          <option value="">Все статусы</option>
          <option value="ready">Ожидает</option>
          <option value="transcribing">Расшифровка</option>
          <option value="done">Готово</option>
          <option value="failed">Ошибка</option>
        </select>

        <button onClick={load} style={{ padding: '6px 12px' }}>Обновить</button>

        <span style={{ flex: 1 }} />

        <input
          placeholder="Поиск по транскриптам…"
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && runSearch()}
          style={{ padding: '6px 10px', width: 280 }}
        />
        <button onClick={runSearch} style={{ padding: '6px 12px' }}>Найти</button>
        {hits !== null && (
          <button
            onClick={() => { setHits(null); setSearchQ('') }}
            style={{ padding: '6px 12px' }}
          >Сброс</button>
        )}
      </div>

      {/* ── Результаты поиска ─────────────────────────────────── */}
      {hits !== null && (
        <div style={{
          background: '#f8f9fa', padding: 12, borderRadius: 6,
          marginBottom: 16,
        }}>
          <strong>Найдено: {hits.length}</strong>
          {hits.map(h => (
            <div
              key={h.recording_id}
              onClick={() => {
                const row = items.find(x => x.id === h.recording_id)
                if (row) openModal(row)
                else openModal({ id: h.recording_id, has_transcript: true,
                                 session_type: h.session_type,
                                 started_at: h.started_at })
              }}
              style={{
                padding: 10, marginTop: 6, background: '#fff',
                borderRadius: 4, cursor: 'pointer',
                border: '1px solid #e8eaed',
              }}
            >
              <div style={{ fontSize: 12, color: '#5f6368' }}>
                {fmtDate(h.started_at)} · {SESSION_LABEL[h.session_type] || h.session_type}
              </div>
              <div style={{ marginTop: 4 }}>{h.snippet}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Таблица ──────────────────────────────────────────── */}
      {loading ? (
        <div>Загрузка…</div>
      ) : items.length === 0 ? (
        <div style={{ color: '#5f6368', padding: 24 }}>
          Записей пока нет. Они появятся здесь после первого записанного звонка.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f1f3f4' }}>
              <th style={th}>Дата</th>
              <th style={th}>Тип</th>
              <th style={th}>Участники</th>
              <th style={th}>Длительность</th>
              <th style={th}>Размер</th>
              <th style={th}>Статус</th>
              <th style={th}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.map(r => {
              const st = STATUS_LABEL[r.status] || { text: r.status, color: '#5f6368' }
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid #e8eaed' }}>
                  <td style={td}>{fmtDate(r.started_at)}</td>
                  <td style={td}>{SESSION_LABEL[r.session_type] || r.session_type}</td>
                  <td style={td}>{fmtParticipants(r.participants)}</td>
                  <td style={td}>{fmtDuration(r.duration_seconds)}</td>
                  <td style={td}>{fmtBytes(r.file_size_bytes)}</td>
                  <td style={td}>
                    <span style={{ color: st.color, fontWeight: 500 }}>
                      {st.text}
                    </span>
                    {r.error_message && (
                      <div style={{ fontSize: 11, color: '#d93025' }}>
                        {r.error_message}
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    <button
                      onClick={() => downloadFile(r.id)}
                      style={btnSm}
                      disabled={!['ready','transcribing','done'].includes(r.status)}
                      title="Скачать файл"
                    >▶</button>
                    {' '}
                    <button
                      onClick={() => openModal(r)}
                      style={btnSm}
                      disabled={!r.has_transcript}
                      title="Открыть транскрипт"
                    >📄</button>
                    {' '}
                    <button
                      onClick={() => removeRow(r.id)}
                      style={{ ...btnSm, color: '#d93025' }}
                      title="Удалить"
                    >🗑</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* ── Modal с транскриптом ──────────────────────────────── */}
      {open && (
        <div style={modalOverlay} onClick={() => setOpen(null)}>
          <div style={modalBox} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, flex: 1 }}>
                Запись от {fmtDate(open.started_at)}
              </h3>
              <button onClick={() => setOpen(null)} style={btnSm}>✕</button>
            </div>

            {trLoading ? (
              <div>Загрузка транскрипта…</div>
            ) : transcript ? (
              <>
                {transcript.summary && (
                  <div style={{
                    background: '#e8f0fe', padding: 12, borderRadius: 6,
                    marginBottom: 12,
                  }}>
                    <strong>AI-резюме:</strong>
                    <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
                      {transcript.summary}
                    </div>
                  </div>
                )}

                <div style={{
                  fontSize: 12, color: '#5f6368', marginBottom: 8,
                }}>
                  Модель: {transcript.model} · Язык: {transcript.language || '—'} ·
                  {' '}Стоимость: ${Number(transcript.cost_usd).toFixed(4)}
                </div>

                {Array.isArray(transcript.segments) && transcript.segments.length > 0 ? (
                  <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                    {transcript.segments.map((seg, i) => (
                      <div key={i} style={{
                        padding: '6px 0',
                        borderBottom: '1px solid #f1f3f4',
                      }}>
                        <span style={{
                          color: '#5f6368', fontSize: 12, marginRight: 8,
                        }}>
                          {fmtDuration(seg.start)} → {fmtDuration(seg.end)}
                        </span>
                        {seg.speaker != null && (
                          <span style={{
                            background: '#e8eaed', padding: '1px 6px',
                            borderRadius: 3, fontSize: 11, marginRight: 6,
                          }}>
                            {seg.speaker}
                          </span>
                        )}
                        <span>{seg.text}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{
                    whiteSpace: 'pre-wrap', maxHeight: 400, overflowY: 'auto',
                    padding: 8, background: '#f8f9fa', borderRadius: 4,
                  }}>
                    {transcript.full_text || '(пусто)'}
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: '#5f6368' }}>
                Транскрипт ещё не готов или модуль не подключён.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const th = { padding: 8, textAlign: 'left', fontWeight: 500, fontSize: 13 }
const td = { padding: 8, fontSize: 13 }
const btnSm = {
  padding: '4px 8px', background: 'transparent', border: '1px solid #dadce0',
  borderRadius: 4, cursor: 'pointer', fontSize: 13,
}
const modalOverlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
}
const modalBox = {
  background: '#fff', borderRadius: 8, padding: 20, maxWidth: 720,
  width: '92%', maxHeight: '88vh', overflowY: 'auto',
}
