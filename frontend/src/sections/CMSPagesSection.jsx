import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE } from '../config';
import { useConfirm } from '../design';

const PAGE_TYPES = ['info', 'landing', 'service', 'contact', 'faq'];

export default function CMSPagesSection({ token }) {
  // Замена window.confirm на Modal-подтверждение
  const { confirm, ConfirmHost } = useConfirm();
  const [pages, setPages] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await axios.get(`${API_BASE}/cms/pages?all=true`, { headers: { Authorization: `Bearer ${token}` } });
      setPages(r.data);
    } catch {}
    setLoading(false);
  }

  function openNew() {
    setForm({ slug: '', title: '', content_md: '', is_published: true, page_type: 'info', show_in_menu: false, menu_title: '', sort_order: 0, seo_title: '', seo_description: '' });
    setEditing('new');
  }

  function openEdit(p) {
    setForm({ ...p });
    setEditing(p.id);
  }

  async function save() {
    try {
      if (editing === 'new') {
        await axios.post(`${API_BASE}/cms/pages`, form, { headers: { Authorization: `Bearer ${token}` } });
      } else {
        await axios.put(`${API_BASE}/cms/pages/${form.slug}`, form, { headers: { Authorization: `Bearer ${token}` } });
      }
      setMsg('Сохранено ✓');
      setEditing(null);
      await load();
    } catch (e) {
      setMsg('Ошибка: ' + (e.response?.data?.detail || e.message));
    }
    setTimeout(() => setMsg(''), 3000);
  }

  async function deletePage(slug) {
    if (!(await confirm('Удалить страницу?', { danger: true, okText: 'Удалить' }))) return;
    await axios.delete(`${API_BASE}/cms/pages/${slug}`, { headers: { Authorization: `Bearer ${token}` } });
    await load();
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const TYPE_LABELS = { info: 'Информация', landing: 'Лендинг', service: 'Услуга', contact: 'Контакты', faq: 'FAQ' };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Загрузка...</div>;

  if (editing !== null) return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>{editing === 'new' ? 'Новая страница' : 'Редактировать страницу'}</h2>
        <button onClick={() => setEditing(null)} style={styles.cancelBtn}>← Назад</button>
      </div>
      {msg && <div style={{ padding: '8px 16px', background: msg.startsWith('Ошибка') ? '#fde' : '#efe', borderRadius: 8, marginBottom: 12 }}>{msg}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div>
          <label style={styles.label}>Slug (URL)</label>
          <input value={form.slug || ''} onChange={e => set('slug', e.target.value)} style={styles.input} placeholder="o-klinike" />
        </div>
        <div>
          <label style={styles.label}>Заголовок</label>
          <input value={form.title || ''} onChange={e => set('title', e.target.value)} style={styles.input} />
        </div>
        <div>
          <label style={styles.label}>Тип страницы</label>
          <select value={form.page_type || 'info'} onChange={e => set('page_type', e.target.value)} style={styles.select}>
            {PAGE_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        <div>
          <label style={styles.label}>Порядок сортировки</label>
          <input type="number" value={form.sort_order || 0} onChange={e => set('sort_order', +e.target.value)} style={styles.input} />
        </div>
        <div>
          <label style={styles.label}>SEO Title</label>
          <input value={form.seo_title || ''} onChange={e => set('seo_title', e.target.value)} style={styles.input} />
        </div>
        <div>
          <label style={styles.label}>SEO Description</label>
          <input value={form.seo_description || ''} onChange={e => set('seo_description', e.target.value)} style={styles.input} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={form.show_in_menu} onChange={e => set('show_in_menu', e.target.checked)} id="inMenu" />
          <label htmlFor="inMenu" style={{ ...styles.label, margin: 0 }}>Показывать в меню</label>
        </div>
        {form.show_in_menu && (
          <div>
            <label style={styles.label}>Текст в меню</label>
            <input value={form.menu_title || ''} onChange={e => set('menu_title', e.target.value)} style={styles.input} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={form.is_published} onChange={e => set('is_published', e.target.checked)} id="isPublished" />
          <label htmlFor="isPublished" style={{ ...styles.label, margin: 0 }}>Опубликована</label>
        </div>
      </div>
      <label style={styles.label}>Контент (Markdown)</label>
      <textarea value={form.content_md || ''} onChange={e => set('content_md', e.target.value)}
        style={{ ...styles.input, height: 300, fontFamily: 'monospace', resize: 'vertical', marginBottom: 16 }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={save} style={styles.saveBtn}>Сохранить</button>
        <button onClick={() => setEditing(null)} style={styles.cancelBtn}>Отмена</button>
      </div>
    </div>
  );

  return (
    <div style={{ padding: 24 }}>
      <ConfirmHost />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>CMS — Страницы тенанта</h2>
        <button onClick={openNew} style={styles.saveBtn}>+ Новая страница</button>
      </div>
      {pages.length === 0 && <div style={{ color: '#888', padding: 20 }}>Страниц пока нет.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pages.map(p => (
          <div key={p.id} style={styles.row}>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600 }}>{p.title}</span>
              <span style={styles.badge}>{p.page_type}</span>
              {!p.is_published && <span style={{ ...styles.badge, background: '#f5f5f5', color: '#999' }}>черновик</span>}
              {p.show_in_menu && <span style={{ ...styles.badge, background: '#e8f5e9', color: '#4caf50' }}>в меню</span>}
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>/{p.slug}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => openEdit(p)} style={styles.editBtn}>Изменить</button>
              <button onClick={() => deletePage(p.slug)} style={styles.deleteBtn}>Удалить</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  label: { fontSize: 13, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 },
  input: { width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' },
  select: { width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 },
  saveBtn: { padding: '8px 20px', background: '#0097A7', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 },
  cancelBtn: { padding: '8px 20px', background: '#f5f5f5', color: '#555', border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer' },
  editBtn: { padding: '6px 14px', background: '#e3f2fd', color: '#0097A7', border: 'none', borderRadius: 6, cursor: 'pointer' },
  deleteBtn: { padding: '6px 14px', background: '#fde', color: '#e53935', border: 'none', borderRadius: 6, cursor: 'pointer' },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10 },
  badge: { display: 'inline-block', marginLeft: 8, padding: '2px 8px', background: '#e3f2fd', color: '#0097A7', borderRadius: 12, fontSize: 11 },
};
