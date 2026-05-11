/**
 * ========================================
 * БЛОК: LabResultsTable — таблица результатов анализов (Глава 10)
 * ========================================
 * Используется в DoctorLabOrdersSection (детальный модал) и
 * PatientLabResultsSection (развёрнутая карточка).
 *
 * props.results: [{ test_code, test_name, value, unit, ref_range, flagged, comment }]
 * props.compact: уменьшенный паддинг для встраивания в карточку пациента.
 *
 * Цветовая палитра:
 *   — flagged === true                  → красный кружок + красный фон строки
 *   — значение в норме (flagged false)  → нейтральный фон, серый кружок
 * ========================================
 */
export default function LabResultsTable({ results = [], compact = false }) {
  if (!Array.isArray(results) || results.length === 0) {
    return (
      <div
        className="rounded-xl p-5 text-center"
        style={{ background: '#f9fafb', border: '1px dashed #e5e7eb', color: '#6b7280', fontSize: 13 }}
      >
        Результаты пока не загружены — лаборатория ещё обрабатывает заявку.
      </div>
    )
  }

  const padCell = compact ? '8px 10px' : '10px 14px'

  return (
    <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid #e5e7eb', background: '#fff' }}>
      <table className="w-full" style={{ fontSize: 13, borderCollapse: 'collapse' }}>
        <thead style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
          <tr style={{ textTransform: 'uppercase', fontSize: 10.5, letterSpacing: '0.06em', color: '#6b7280' }}>
            <th style={{ padding: padCell, textAlign: 'left', fontWeight: 600 }}>Тест</th>
            <th style={{ padding: padCell, textAlign: 'right', fontWeight: 600 }}>Значение</th>
            <th style={{ padding: padCell, textAlign: 'left',  fontWeight: 600 }}>Ед.</th>
            <th style={{ padding: padCell, textAlign: 'left',  fontWeight: 600 }}>Норма</th>
            <th style={{ padding: padCell, width: 36 }}></th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const flagged = !!r.flagged
            return (
              <tr
                key={r.id || r.test_code || i}
                style={{
                  borderBottom: i === results.length - 1 ? 'none' : '1px solid #f1f5f9',
                  background: flagged ? '#fef2f2' : 'transparent',
                }}
              >
                <td style={{ padding: padCell, color: '#0f172a', fontWeight: 600 }}>
                  <div>{r.test_name || r.test_code || '—'}</div>
                  {r.comment && (
                    <div style={{ color: '#6b7280', fontWeight: 400, fontSize: 11, marginTop: 2 }}>
                      {r.comment}
                    </div>
                  )}
                </td>
                <td
                  style={{
                    padding: padCell,
                    textAlign: 'right',
                    color: flagged ? '#b91c1c' : '#0f172a',
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {r.value ?? '—'}
                </td>
                <td style={{ padding: padCell, color: '#6b7280' }}>{r.unit || ''}</td>
                <td style={{ padding: padCell, color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>
                  {r.ref_range || r.reference_range || '—'}
                </td>
                <td style={{ padding: padCell, textAlign: 'center' }}>
                  <span
                    title={flagged ? 'Отклонение от нормы' : 'В норме'}
                    style={{
                      display: 'inline-block',
                      width: 10, height: 10, borderRadius: 999,
                      background: flagged ? '#ef4444' : '#cbd5e1',
                      boxShadow: flagged ? '0 0 0 3px rgba(239,68,68,0.18)' : 'none',
                    }}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
