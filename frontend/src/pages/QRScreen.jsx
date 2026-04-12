import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getReferral } from '../api'
import api from '../api'

const STATUS_STYLE = {
  created:          'bg-[#dae5ff] text-[#1565c0]',
  confirmed:        'bg-[#dcfce7] text-[#166534]',
  expired:          'bg-[#eceef0] text-[#727783]',
  cancel_requested: 'bg-orange-100 text-orange-700',
  cancelled:        'bg-red-100 text-red-700',
}
const STATUS_LABELS = {
  created: 'Создано', confirmed: 'Подтверждено', expired: 'Истекло',
  cancel_requested: 'На отмене', cancelled: 'Отменено',
}

export default function QRScreen() {
  const { id } = useParams()
  const [referral, setReferral] = useState(null)
  const [shareMsg, setShareMsg] = useState('')
  const [comments, setComments] = useState([])
  const [newComment, setNewComment] = useState('')
  const [sendingComment, setSendingComment] = useState(false)
  const nav = useNavigate()
  const imgRef = useRef(null)

  useEffect(() => {
    getReferral(id).then(r => setReferral(r.data)).catch(() => nav('/'))
    api.get(`/referrals/${id}/comments`).then(r => setComments(r.data)).catch(() => {})
  }, [id])

  const handleSendComment = async () => {
    if (!newComment.trim()) return
    setSendingComment(true)
    try {
      const res = await api.post(`/referrals/${id}/comments`, { text: newComment.trim() })
      setComments(prev => [...prev, res.data])
      setNewComment('')
    } catch {} finally { setSendingComment(false) }
  }

  const handlePrint = () => {
    const qrDataUrl = `data:image/png;base64,${referral.qr_code}`
    const apptLine = referral.appointment_at
      ? `<p>📅 Запись: ${new Date(referral.appointment_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>`
      : ''
    const win = window.open('', '_blank')
    win.document.write(`<html><head><title>QR направление</title>
      <style>body{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;}
      img{width:260px;height:260px;}p{margin:6px 0;font-size:14px;color:#555;text-align:center;}h3{margin:0 0 8px;font-size:16px;text-align:center;}</style>
      </head><body><h3>${referral.service_name}</h3><p>📍 ${referral.to_clinic_name}</p>
      <img src="${qrDataUrl}" /><p>📞 ${referral.patient_phone}</p>${apptLine}
      <p style="font-size:12px;color:#999">Действует до: ${new Date(referral.expires_at).toLocaleDateString('ru-RU')}</p>
      <script>window.onload=()=>{window.print();window.close()}<\/script></body></html>`)
    win.document.close()
  }

  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = `data:image/png;base64,${referral.qr_code}`
    link.download = `qr-направление-${referral.patient_phone}.png`
    link.click()
  }

  const handleShare = async () => {
    const qrDataUrl = `data:image/png;base64,${referral.qr_code}`
    try {
      const res = await fetch(qrDataUrl)
      const blob = await res.blob()
      const file = new File([blob], 'qr-napravlenie.png', { type: 'image/png' })
      if (navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({ title: `QR направление — ${referral.service_name}`, files: [file] })
      } else if (navigator.share) {
        await navigator.share({ title: `QR направление — ${referral.service_name}`, text: `Направление в ${referral.to_clinic_name}` })
      } else {
        handleDownload()
        setShareMsg('QR сохранён — отправьте пациенту сами')
        setTimeout(() => setShareMsg(''), 3000)
      }
    } catch (e) { if (e.name !== 'AbortError') handleDownload() }
  }

  if (!referral) return (
    <div className="flex items-center justify-center min-h-screen bg-[#f7f9fb]">
      <div className="w-8 h-8 border-[3px] border-[#1565c0] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const daysLeft = Math.ceil((new Date(referral.expires_at) - new Date()) / (1000 * 60 * 60 * 24))

  return (
    <div className="bg-[#f7f9fb] min-h-screen pb-24">
      <div className="px-4 pt-4 space-y-3">

        {/* Кнопка назад */}
        <button onClick={() => nav(-1)} className="flex items-center gap-1.5 text-[#1565c0] text-sm font-semibold">
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          Назад
        </button>

        {/* Карточка с инфо */}
        <div className="bg-white rounded-3xl p-5" style={{ boxShadow: '0 4px 20px rgba(25,28,30,0.06)' }}>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="font-bold text-[#191c1e] font-headline text-lg leading-tight">{referral.service_name}</h2>
              <p className="text-sm text-[#727783] mt-0.5">{referral.to_clinic_name}</p>
            </div>
            <span className={`flex-shrink-0 text-[11px] px-2.5 py-1 rounded-full font-bold uppercase tracking-tight ${STATUS_STYLE[referral.status] || 'bg-[#eceef0] text-[#727783]'}`}>
              {STATUS_LABELS[referral.status] || referral.status}
            </span>
          </div>

          <div className="space-y-2">
            {referral.patient_name && (
              <div className="flex items-center gap-2 text-sm text-[#424752]">
                <span className="material-symbols-outlined text-[#c2c6d4]" style={{ fontSize: 16 }}>person</span>
                {referral.patient_name}
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-[#424752]">
              <span className="material-symbols-outlined text-[#c2c6d4]" style={{ fontSize: 16 }}>phone</span>
              {referral.patient_phone}
            </div>
            {referral.appointment_at && (
              <div className="flex items-center gap-2 text-sm font-semibold text-[#1565c0]">
                <span className="material-symbols-outlined text-[#1565c0]" style={{ fontSize: 16 }}>calendar_today</span>
                {new Date(referral.appointment_at).toLocaleString('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
            {referral.status === 'created' && daysLeft > 0 && (
              <div className="flex items-center gap-2 text-sm text-[#c2410c]">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>schedule</span>
                Действует ещё {daysLeft} дн.
              </div>
            )}
            {referral.bonus_amount > 0 && (
              <div className="flex items-center gap-2 text-sm font-semibold text-[#166534]">
                <span className="material-symbols-outlined" style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}>payments</span>
                Бонус: {referral.bonus_amount} Б
              </div>
            )}
          </div>
        </div>

        {/* QR код сотрудника */}
        {referral.qr_code && referral.status === 'created' && (
          <div className="bg-white rounded-3xl p-5 text-center" style={{ boxShadow: '0 4px 20px rgba(25,28,30,0.06)' }}>
            <p className="text-xs font-semibold text-[#727783] uppercase tracking-wider mb-4">QR для подтверждения визита</p>
            <div className="bg-[#f7f9fb] rounded-2xl p-4 inline-block mb-4">
              <img ref={imgRef} src={`data:image/png;base64,${referral.qr_code}`} alt="QR код" className="w-[180px] h-[180px]" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: 'share', label: 'Отправить', onClick: handleShare, primary: true },
                { icon: 'print', label: 'Распечатать', onClick: handlePrint },
                { icon: 'download', label: 'Скачать', onClick: handleDownload },
              ].map(btn => (
                <button key={btn.label} onClick={btn.onClick}
                  className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-2xl text-xs font-semibold transition active:scale-95 ${
                    btn.primary
                      ? 'text-white'
                      : 'bg-[#f2f4f6] text-[#424752] hover:bg-[#eceef0]'
                  }`}
                  style={btn.primary ? { background: 'linear-gradient(135deg, #1565c0, #1e6fe8)', boxShadow: '0 4px 12px rgba(21,101,192,0.25)' } : {}}>
                  <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>{btn.icon}</span>
                  {btn.label}
                </button>
              ))}
            </div>
            {shareMsg && <p className="text-xs text-[#727783] mt-3">{shareMsg}</p>}
          </div>
        )}

        {/* Кабинет пациента */}
        {referral.patient_qr_code && referral.status === 'created' && (
          <div className="bg-white rounded-3xl p-5" style={{ boxShadow: '0 4px 20px rgba(25,28,30,0.06)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-[#dae5ff] flex items-center justify-center">
                <span className="material-symbols-outlined text-[#1565c0] text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>person</span>
              </div>
              <div>
                <p className="font-bold text-[#191c1e] text-sm font-headline">Кабинет пациента</p>
                <p className="text-xs text-[#727783]">Сканирует QR → личный кабинет</p>
              </div>
            </div>
            <div className="bg-[#f7f9fb] rounded-2xl p-4 text-center mb-3">
              <img src={`data:image/png;base64,${referral.patient_qr_code}`} alt="QR кабинет" className="w-[160px] h-[160px] mx-auto" />
            </div>
            {referral.short_code && (
              <div className="bg-[#f2f4f6] rounded-2xl p-4">
                <p className="text-[11px] text-[#727783] font-semibold uppercase tracking-wider mb-2">Код без QR</p>
                <p className="text-3xl font-extrabold tracking-[0.3em] text-[#191c1e] font-headline text-center mb-3">{referral.short_code}</p>
                <div className="border-t border-[#eceef0] pt-3">
                  <p className="text-[11px] text-[#727783] mb-1.5">Ссылка для ввода кода:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-white rounded-xl px-3 py-2 text-[#1565c0] font-mono truncate border border-[#eceef0]">
                      {window.location.origin}/clinika/p
                    </code>
                    <button onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/clinika/p`)}
                      className="w-9 h-9 bg-white rounded-xl flex items-center justify-center text-[#727783] hover:text-[#1565c0] border border-[#eceef0] transition flex-shrink-0">
                      <span className="material-symbols-outlined text-lg">content_copy</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Подтверждено */}
        {referral.status === 'confirmed' && (
          <div className="bg-[#dcfce7] rounded-3xl p-6 text-center">
            <div className="w-14 h-14 bg-[#166534]/10 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="material-symbols-outlined text-[#166534] text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            </div>
            <p className="font-bold text-[#166534] font-headline">Направление подтверждено</p>
            {referral.bonus_amount > 0 && (
              <p className="text-[#166534]/80 text-sm mt-1">Вам начислено {referral.bonus_amount} Б</p>
            )}
          </div>
        )}

        {/* Заметки */}
        <div className="bg-white rounded-3xl p-5" style={{ boxShadow: '0 4px 20px rgba(25,28,30,0.06)' }}>
          <h3 className="text-sm font-bold text-[#191c1e] font-headline mb-4">
            Заметки{comments.length > 0 && <span className="text-[#727783] font-normal ml-1">({comments.length})</span>}
          </h3>

          {comments.length === 0 && (
            <p className="text-xs text-[#c2c6d4] mb-3">Заметок пока нет</p>
          )}

          <div className="space-y-2 mb-3">
            {comments.map(c => (
              <div key={c.id} className="bg-[#f2f4f6] rounded-2xl px-4 py-3">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-xs font-semibold text-[#424752]">{c.author_name}</span>
                  <span className="text-[11px] text-[#727783]">
                    {new Date(c.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-sm text-[#191c1e]">{c.text}</p>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <input type="text" placeholder="Добавить заметку..."
              value={newComment} onChange={e => setNewComment(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSendComment()}
              className="flex-1 bg-[#f2f4f6] rounded-2xl px-4 py-3 text-sm text-[#191c1e] outline-none border-2 border-transparent focus:border-[#1565c0]/30 focus:bg-white transition-all placeholder-[#727783]"
            />
            <button onClick={handleSendComment} disabled={!newComment.trim() || sendingComment}
              className="w-12 h-12 rounded-2xl text-white flex items-center justify-center disabled:opacity-40 flex-shrink-0 transition active:scale-95"
              style={{ background: 'linear-gradient(135deg, #1565c0, #1e6fe8)' }}>
              <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                {sendingComment ? 'hourglass_empty' : 'send'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
