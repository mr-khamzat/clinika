import React, { useState, useEffect } from 'react';
import api from '../api';
import { useConfirm } from '../design';

const STATUS_LABELS = {
  draft: { label: 'Черновик', color: '#9e9e9e' },
  generated: { label: 'Сформирован', color: '#1976d2' },
  sent: { label: 'Отправлен', color: '#0097A7' },
  signed: { label: 'Подписан', color: '#4caf50' },
  paid: { label: 'Оплачен', color: '#2e7d32' },
  overdue: { label: 'Просрочен', color: '#e53935' },
};

export default function ActsSection({ token, isSuperAdmin }) {
  const [acts, setActs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [genForm, setGenForm] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 });
  const [signModal, setSignModal] = useState(null);
  const [signerName, setSignerName] = useState('');
  const [msg, setMsg] = useState('');
  // Замена window.confirm на Modal-диалог из design-system
  const { confirm, ConfirmHost } = useConfirm();

  useEffect(() => { load(); }, [filter]);

  async function load() {
    setLoading(true);
    try {
      const params = filter ? `?act_status=${filter}` : '';
      const r = await api.get(`/acts/${params}`);
      setActs(r.data);
    } catch {}
    setLoading(false);
  }

  async function generateAct() {
    try {
      await api.post('/acts/generate', genForm);
      setMsg('Акт сформирован ✓');
      await load();
    } catch (e) {
      setMsg('Ошибка: ' + (e.response?.data?.detail || e.message));
    }
    setTimeout(() => setMsg(''), 4000);
  }

  async function signAct() {
    if (!signerName.trim()) return;
    try {
      await api.post(`/acts/${signModal}/sign`, { signer_name: signerName });
      setSignModal(null);
      setSignerName('');
      setMsg('Акт подписан ✓');
      await load();
    } catch (e) {
      setMsg('Ошибка: ' + (e.response?.data?.detail || e.message));
    }
    setTimeout(() => setMsg(''), 4000);
  }

  async function payAct(act_number, amount) {
    await api.post(`/acts/${act_number}/pay`, { amount });
    setMsg('Оплата зарегистрирована ✓');
    await load();
    setTimeout(() => setMsg(''), 3000);
  }

  // Скачивание PDF акта (бэк отдаёт application/pdf)
  async function downloadPdf(act) {
    try {
      const r = await api.get(`/acts/${act.id || act.act_number}/pdf`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `act_${act.act_number || act.invoice_number || 'document'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setMsg('Ошибка PDF: ' + (e.response?.data?.detail || e.message));
      setTimeout(() => setMsg(''), 4000);
    }
  }

  // Электронная подпись (внутренняя, без КЭП — TODO: реальная ЭЦП)
  async function signElectronic(act) {
    const ok = await confirm('Подписать акт электронной подписью? Это действие необратимо.', { okText: 'Подписать', danger: true });
    if (!ok) return;
    try {
      await api.post(`/acts/${act.id || act.act_number}/sign-electronic`, {});
      setMsg('Акт подписан электронно ✓');
      await load();
    } catch (e) {
      setMsg('Ошибка ЭП: ' + (e.response?.data?.detail || e.message));
    }
    setTimeout(() => setMsg(''), 4000);
  }

  const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: '0 0 20px' }}>Акты оказанных услуг</h2>
      {msg && <div style={{ padding: '8px 16px', background: msg.startsWith('Ошибка') ? '#fde' : '#efe', borderRadius: 8, marginBottom: 12 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={styles.card}>
          <div style={styles.cardTitle}>Сформировать акт</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <select value={genForm.month} onChange={e => setGenForm(f => ({ ...f, month: +e.target.value }))} style={styles.select}>
              {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
            <input type="number" value={genForm.year} onChange={e => setGenForm(f => ({ ...f, year: +e.target.value }))}
              style={{ ...styles.input, width: 80 }} />
            <button onClick={generateAct} style={styles.btn}>Создать</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <button onClick={() => setFilter('')} style={{ ...styles.filterBtn, ...(filter === '' ? styles.filterActive : {}) }}>Все</button>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <button key={k} onClick={() => setFilter(k)}
              style={{ ...styles.filterBtn, ...(filter === k ? { background: v.color, color: '#fff', borderColor: v.color } : {}) }}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div style={{ color: '#888', padding: 20 }}>Загрузка...</div>}
      {!loading && acts.length === 0 && <div style={{ color: '#888', padding: 20 }}>Актов нет.</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {acts.map(a => {
          const st = STATUS_LABELS[a.act_status] || { label: a.act_status, color: '#888' };
          return (
            <div key={a.id} style={styles.row}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{a.act_number || a.invoice_number}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                  {a.legal_entity_name || '—'} &nbsp;|&nbsp;
                  {a.period_start ? new Date(a.period_start).toLocaleDateString('ru') : '?'} — {a.period_end ? new Date(a.period_end).toLocaleDateString('ru') : '?'}
                  &nbsp;|&nbsp; До: {a.due_date ? new Date(a.due_date).toLocaleDateString('ru') : '?'}
                </div>
                {a.notes && <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{a.notes}</div>}
              </div>
              <div style={{ textAlign: 'right', minWidth: 140 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{Number(a.total || a.amount || 0).toLocaleString('ru')} ₽</div>
                <span style={{ ...styles.badge, background: st.color + '22', color: st.color }}>{st.label}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexDirection: 'column' }}>
                {/* Кнопка скачивания PDF — доступна всегда */}
                <button onClick={() => downloadPdf(a)} style={styles.pdfBtn} title="Скачать PDF">
                  Скачать PDF
                </button>
                {['generated', 'sent'].includes(a.act_status) && (
                  <>
                    <button onClick={() => { setSignModal(a.act_number); setSignerName(''); }} style={styles.signBtn}>
                      Подписать
                    </button>
                    {/* Электронная подпись (упрощённая, internal — TODO: реальная ЭЦП) */}
                    <button onClick={() => signElectronic(a)} style={styles.signEBtn} title="Простая электронная подпись (КЭП в разработке)">
                      Подписать электронно
                    </button>
                  </>
                )}
                {a.act_status === 'signed' && isSuperAdmin && (
                  <button onClick={() => payAct(a.act_number, a.total || a.amount)} style={styles.payBtn}>Оплачен</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {signModal && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <h3 style={{ margin: '0 0 16px' }}>Подписать акт {signModal}</h3>
            <label style={styles.label}>ФИО подписанта</label>
            <input value={signerName} onChange={e => setSignerName(e.target.value)} style={{ ...styles.input, width: '100%', marginBottom: 16 }}
              placeholder="Иванов Иван Иванович" />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setSignModal(null)} style={styles.cancelBtn}>Отмена</button>
              <button onClick={signAct} style={styles.btn}>Подписать ЭЦП</button>
            </div>
          </div>
        </div>
      )}
      <ConfirmHost />
    </div>
  );
}

const styles = {
  card: { background: '#f9f9f9', border: '1px solid #e0e0e0', borderRadius: 10, padding: '12px 16px', minWidth: 280 },
  cardTitle: { fontWeight: 600, fontSize: 14 },
  input: { padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 },
  select: { padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 },
  btn: { padding: '7px 16px', background: '#0097A7', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 },
  filterBtn: { padding: '5px 12px', background: '#f5f5f5', color: '#555', border: '1px solid #ddd', borderRadius: 20, cursor: 'pointer', fontSize: 13 },
  filterActive: { background: '#0097A7', color: '#fff', borderColor: '#0097A7' },
  signBtn: { padding: '5px 12px', background: '#e3f2fd', color: '#1976d2', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  signEBtn: { padding: '5px 12px', background: '#f3e5f5', color: '#6a1b9a', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  pdfBtn: { padding: '5px 12px', background: '#fff3e0', color: '#e65100', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  payBtn: { padding: '5px 12px', background: '#e8f5e9', color: '#2e7d32', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  cancelBtn: { padding: '7px 16px', background: '#f5f5f5', color: '#555', border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer' },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10 },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 4 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#fff', borderRadius: 16, padding: 28, width: 400, boxShadow: '0 10px 40px rgba(0,0,0,.2)' },
};
