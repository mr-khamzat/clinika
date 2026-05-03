/**
 * ActPrintModal — печать межклинического счёта/акта в формате A4.
 * Вызывает window.print() с CSS @media print.
 */
import { useEffect, useState, useRef } from 'react'
import { API_BASE } from '../config'

function fmt(n) {
  return Number(n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function rubles(n) {
  const v = Number(n || 0)
  const rub = Math.floor(v)
  const kop = Math.round((v - rub) * 100)
  const ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
  const teens = ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать']
  const tens = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто']
  const hundreds = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот']
  function word(n, female = false) {
    if (n === 0) return ''
    if (n < 10) return (female && n === 1 ? 'одна' : female && n === 2 ? 'две' : ones[n])
    if (n < 20) return teens[n - 10]
    return (tens[Math.floor(n / 10)] + (n % 10 ? ' ' + word(n % 10, female) : '')).trim()
  }
  function thousands(n) {
    const h = hundreds[Math.floor(n / 100)]
    const rest = n % 100
    const t = rest < 20 ? (rest < 10 ? '' : teens[rest - 10]) : tens[Math.floor(rest / 10)]
    const o = rest < 20 ? '' : (rest % 10 === 1 ? 'одна' : rest % 10 === 2 ? 'две' : ones[rest % 10] || '')
    const parts = [h, t, o].filter(Boolean).join(' ')
    const k = n % 10 === 1 && n % 100 !== 11 ? 'тысяча' : (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) ? 'тысячи' : 'тысяч'
    return (parts + ' ' + k).trim()
  }
  let text = ''
  if (rub >= 1000) text += thousands(Math.floor(rub / 1000)) + ' '
  text += word(rub % 1000) || (rub === 0 ? 'ноль' : '')
  const rubWord = rub % 10 === 1 && rub % 100 !== 11 ? 'рубль' : (rub % 10 >= 2 && rub % 10 <= 4 && !(rub % 100 >= 12 && rub % 100 <= 14)) ? 'рубля' : 'рублей'
  const kopWord = kop % 10 === 1 && kop % 100 !== 11 ? 'копейка' : (kop % 10 >= 2 && kop % 10 <= 4 && !(kop % 100 >= 12 && kop % 100 <= 14)) ? 'копейки' : 'копеек'
  return (text.trim().replace(/^\w/, c => c.toUpperCase()) + ' ' + rubWord + ' ' + String(kop).padStart(2, '0') + ' ' + kopWord)
}

const TYPE_LABEL = {
  referral_bonus: 'Реферальный бонус',
  manual: 'Услуги по договору',
  royalty: 'Роялти',
  correction: 'Корректировка',
}

export default function ActPrintModal({ invoiceId, token, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const printRef = useRef()

  useEffect(() => {
    fetch(`${API_BASE}/clinic-invoices/${invoiceId}/act`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(d => { if (d.invoice) setData(d); else setError(d.detail || 'Ошибка') })
      .catch(() => setError('Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [invoiceId])

  useEffect(() => {
    const fn = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  const handlePrint = () => {
    const content = printRef.current.innerHTML
    const win = window.open('', '_blank', 'width=900,height=700')
    win.document.write(`<!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <title>Акт ${data?.invoice?.invoice_number || ''}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Times New Roman', serif; font-size: 12pt; color: #000; background: #fff; }
        .page { width: 210mm; min-height: 297mm; padding: 20mm 20mm 25mm 25mm; margin: 0 auto; position: relative; }
        h1 { font-size: 14pt; text-align: center; font-weight: bold; margin-bottom: 4pt; }
        .subtitle { text-align: center; font-size: 11pt; margin-bottom: 16pt; }
        .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 20pt; margin-bottom: 16pt; border: 1px solid #000; }
        .party { padding: 8pt; }
        .party-title { font-weight: bold; font-size: 10pt; border-bottom: 1px solid #000; padding-bottom: 4pt; margin-bottom: 6pt; }
        .party-row { font-size: 9pt; margin-bottom: 3pt; }
        .party-label { color: #555; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 12pt; }
        th { border: 1px solid #000; padding: 5pt 4pt; font-size: 10pt; font-weight: bold; text-align: center; background: #f5f5f5; }
        td { border: 1px solid #000; padding: 4pt; font-size: 10pt; vertical-align: top; }
        td.center { text-align: center; }
        td.right { text-align: right; }
        .total-row td { font-weight: bold; }
        .rubles { font-size: 10pt; margin-bottom: 16pt; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 30pt; margin-top: 20pt; }
        .sig-block { }
        .sig-title { font-weight: bold; font-size: 10pt; margin-bottom: 8pt; }
        .sig-line { display: flex; align-items: flex-end; gap: 8pt; margin-bottom: 8pt; }
        .sig-label { font-size: 9pt; white-space: nowrap; }
        .sig-underline { flex: 1; border-bottom: 1px solid #000; height: 20pt; }
        .stamp-area { position: relative; height: 80pt; display: flex; align-items: center; }
        .stamp-img { max-height: 75pt; max-width: 120pt; opacity: 0.85; position: absolute; bottom: 0; left: 20pt; }
        .stamp-placeholder { width: 75pt; height: 75pt; border: 1px dashed #aaa; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 8pt; color: #aaa; text-align: center; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .page { padding: 15mm 15mm 20mm 20mm; }
          @page { size: A4 portrait; margin: 0; }
        }
      </style>
    </head><body><div class="page">${content}</div></body></html>`)
    win.document.close()
    setTimeout(() => { win.focus(); win.print() }, 400)
  }

  if (loading) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl p-8 text-center">
        <div className="w-8 h-8 border-2 border-[#0A2342] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-500 text-sm">Загрузка акта...</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center">
        <p className="text-red-500 mb-4">{error}</p>
        <button onClick={onClose} className="px-6 py-2 bg-gray-100 rounded-xl text-sm font-semibold">Закрыть</button>
      </div>
    </div>
  )

  const { invoice, issuer, recipient } = data
  const amount = invoice.amount
  const now = new Date()
  const dateStr = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const serviceDesc = invoice.description || TYPE_LABEL[invoice.invoice_type] || 'Оказанные услуги'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60 overflow-y-auto">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-[#0A2342] flex items-center gap-3 px-6 py-3 shadow-xl">
        <span className="material-symbols-outlined text-white">description</span>
        <span className="text-white font-semibold flex-1">Акт № {invoice.invoice_number}</span>
        <button onClick={handlePrint}
          className="flex items-center gap-2 px-4 py-2 bg-[#00b4d8] hover:bg-[#0096b7] text-white rounded-xl font-semibold text-sm transition">
          <span className="material-symbols-outlined text-lg">print</span>
          Распечатать
        </button>
        <button onClick={onClose} className="text-white/60 hover:text-white ml-2">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      {/* A4 Preview */}
      <div className="flex-1 bg-gray-300 p-8 flex justify-center">
        <div ref={printRef} style={{
          width: '210mm', minHeight: '297mm', background: '#fff',
          padding: '20mm 20mm 25mm 25mm',
          boxShadow: '0 4px 32px rgba(0,0,0,0.2)',
          fontFamily: '"Times New Roman", serif', fontSize: '12pt', color: '#000',
        }}>
          {/* Заголовок */}
          <h1 style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '14pt', marginBottom: 4 }}>
            АКТ № {invoice.invoice_number}
          </h1>
          <p style={{ textAlign: 'center', fontSize: '11pt', marginBottom: 16 }}>
            об оказании услуг от {dateStr}
          </p>

          {/* Стороны */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, border: '1px solid #000', marginBottom: 16 }}>
            {[{ title: 'ИСПОЛНИТЕЛЬ', data: issuer }, { title: 'ЗАКАЗЧИК', data: recipient }].map(({ title, data: d }) => (
              <div key={title} style={{ padding: '8pt', borderRight: title === 'ИСПОЛНИТЕЛЬ' ? '1px solid #000' : 'none' }}>
                <div style={{ fontWeight: 'bold', fontSize: '10pt', borderBottom: '1px solid #000', paddingBottom: 4, marginBottom: 6 }}>{title}</div>
                {[
                  ['Организация', d.name],
                  ['ИНН', d.inn], ['КПП', d.kpp], ['ОГРН', d.ogrn],
                  ['Адрес', d.address],
                  ['Телефон', d.phone], ['Email', d.email],
                  ['Банк', d.bank_name],
                  ['р/с', d.bank_account],
                  ['БИК', d.bank_bik],
                  ['к/с', d.bank_corr],
                ].map(([label, val]) => val ? (
                  <div key={label} style={{ fontSize: '9pt', marginBottom: 2 }}>
                    <span style={{ color: '#555' }}>{label}: </span>{val}
                  </div>
                ) : null)}
              </div>
            ))}
          </div>

          {/* Таблица услуг */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
            <thead>
              <tr>
                {['№', 'Наименование услуги', 'Ед.', 'Кол-во', 'Цена, ₽', 'Сумма, ₽'].map(h => (
                  <th key={h} style={{ border: '1px solid #000', padding: '5pt 4pt', fontSize: '10pt', fontWeight: 'bold', textAlign: 'center', background: '#f5f5f5' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ border: '1px solid #000', padding: '4pt', textAlign: 'center', fontSize: '10pt' }}>1</td>
                <td style={{ border: '1px solid #000', padding: '4pt', fontSize: '10pt' }}>{serviceDesc}</td>
                <td style={{ border: '1px solid #000', padding: '4pt', textAlign: 'center', fontSize: '10pt' }}>усл.</td>
                <td style={{ border: '1px solid #000', padding: '4pt', textAlign: 'center', fontSize: '10pt' }}>1</td>
                <td style={{ border: '1px solid #000', padding: '4pt', textAlign: 'right', fontSize: '10pt' }}>{fmt(amount)}</td>
                <td style={{ border: '1px solid #000', padding: '4pt', textAlign: 'right', fontSize: '10pt' }}>{fmt(amount)}</td>
              </tr>
              <tr>
                <td colSpan={4} style={{ border: '1px solid #000', padding: '4pt', textAlign: 'right', fontSize: '10pt', fontWeight: 'bold' }}>Итого:</td>
                <td colSpan={2} style={{ border: '1px solid #000', padding: '4pt', textAlign: 'right', fontSize: '10pt', fontWeight: 'bold' }}>{fmt(amount)} ₽</td>
              </tr>
              <tr>
                <td colSpan={4} style={{ border: '1px solid #000', padding: '4pt', textAlign: 'right', fontSize: '10pt' }}>НДС не облагается:</td>
                <td colSpan={2} style={{ border: '1px solid #000', padding: '4pt', textAlign: 'right', fontSize: '10pt' }}>—</td>
              </tr>
              <tr>
                <td colSpan={4} style={{ border: '1px solid #000', padding: '4pt', textAlign: 'right', fontSize: '10pt', fontWeight: 'bold' }}>Всего к оплате:</td>
                <td colSpan={2} style={{ border: '1px solid #000', padding: '4pt', textAlign: 'right', fontSize: '11pt', fontWeight: 'bold' }}>{fmt(amount)} ₽</td>
              </tr>
            </tbody>
          </table>

          {/* Сумма прописью */}
          <p style={{ fontSize: '10pt', marginBottom: 16 }}>
            <b>Всего оказано услуг на сумму:</b> {rubles(amount)}
          </p>
          <p style={{ fontSize: '10pt', marginBottom: 24 }}>
            Вышеперечисленные услуги выполнены полностью и в срок. Заказчик претензий по объёму, качеству и срокам оказания услуг не имеет.
          </p>

          {/* Подписи */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30pt' }}>
            {[
              { title: 'ИСПОЛНИТЕЛЬ', d: issuer },
              { title: 'ЗАКАЗЧИК', d: recipient },
            ].map(({ title, d }) => (
              <div key={title}>
                <div style={{ fontWeight: 'bold', fontSize: '10pt', marginBottom: 8 }}>{title}</div>
                {[
                  [d.signer_pos || 'Руководитель', ''],
                  ['М.П.', ''],
                  [d.signer_name || '', ''],
                ].map(([label, val], i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: '9pt', whiteSpace: 'nowrap' }}>{label}</span>
                    <span style={{ flex: 1, borderBottom: '1px solid #000', display: 'inline-block', minWidth: 60 }}>&nbsp;</span>
                  </div>
                ))}
                {/* Печать */}
                <div style={{ height: 80, display: 'flex', alignItems: 'flex-end', marginTop: 4 }}>
                  {d.stamp_url ? (
                    <img src={API_BASE + d.stamp_url} alt="Печать"
                      style={{ maxHeight: 75, maxWidth: 120, opacity: 0.85 }} />
                  ) : (
                    <div style={{ width: 75, height: 75, border: '1px dashed #bbb', borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '8pt', color: '#aaa', textAlign: 'center', padding: 6 }}>
                      Место<br/>печати
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
