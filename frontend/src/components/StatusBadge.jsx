const statusMap = {
  created:          { label: 'Создано',           cls: 'bg-[#dae5ff] text-[#1565c0]' },
  confirmed:        { label: 'Подтверждено',       cls: 'bg-[#dcfce7] text-[#166534]' },
  expired:          { label: 'Просрочено',         cls: 'bg-[#eceef0] text-[#727783]' },
  cancelled:        { label: 'Отменено',           cls: 'bg-red-100 text-[#ba1a1a]' },
  cancel_requested: { label: 'Запрос на отмену',  cls: 'bg-orange-100 text-orange-700' },
}

export default function StatusBadge({ status }) {
  const s = statusMap[status] || { label: status, cls: 'bg-[#eceef0] text-[#727783]' }
  return (
    <span className={"px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-tight inline-flex items-center " + s.cls}>
      {s.label}
    </span>
  )
}
