/**
 * ResponsiveTable — универсальная таблица с автоматической адаптацией под мобильные.
 *
 * На ≥768px рендерится обычная <table>; на <768px каждая строка превращается
 * в карточку «ключ → значение» (через CSS-класс admin-resp-table из index.css).
 *
 * API:
 *   columns: Array<{ key: string, label: string, render?: (row, idx) => ReactNode, className?: string }>
 *   rows:    Array<any>  — данные
 *   rowKey:  (row, idx) => string  — ключ каждой строки (default — idx)
 *   onRowClick: (row) => void — необязательно, делает строку кликабельной
 *   className: string — дополнительные классы для <table>
 *   empty:   ReactNode — что показать если нет строк
 *
 * Пример:
 *   <ResponsiveTable
 *     columns={[
 *       { key: 'name', label: 'Имя' },
 *       { key: 'created', label: 'Создан', render: r => formatDate(r.created) },
 *     ]}
 *     rows={tenants}
 *     rowKey={r => r.id}
 *   />
 */
export default function ResponsiveTable({
  columns,
  rows,
  rowKey,
  onRowClick,
  className = '',
  empty = null,
}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return empty
  }
  return (
    <table
      className={`admin-resp-table w-full text-sm ${className}`}
      style={{ borderCollapse: 'collapse' }}
    >
      <thead>
        <tr>
          {columns.map(col => (
            <th
              key={col.key}
              className={col.className || ''}
              style={{
                textAlign: 'left',
                padding: '8px 10px',
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--fg-3, #6b7280)',
                borderBottom: '1px solid var(--border, rgba(0,0,0,0.08))',
              }}
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr
            key={rowKey ? rowKey(row, idx) : idx}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            style={{
              cursor: onRowClick ? 'pointer' : 'default',
              borderBottom: '1px solid var(--border, rgba(0,0,0,0.05))',
            }}
          >
            {columns.map(col => (
              <td
                key={col.key}
                data-label={col.label}
                className={col.className || ''}
                style={{ padding: '10px', verticalAlign: 'middle' }}
              >
                {col.render ? col.render(row, idx) : row[col.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
