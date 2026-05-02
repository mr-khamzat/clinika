import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE } from '../config';
import { applyTheme } from '../utils/ThemeLoader';

const FONT_OPTIONS = ['Inter', 'Roboto', 'Open Sans', 'Montserrat', 'Nunito', 'PT Sans'];

export default function BrandingSection() {
  const [form, setForm] = useState({
    brand_name: '', primary_color: '#0097A7', secondary_color: '#E0F7FA',
    sidebar_color: '#004D5F', bg_color: '#F0F5F6', font_family: 'Inter',
    logo_url: '', favicon_url: '', og_image_url: '', footer_text: '',
    custom_domain: '', meta_title: '', meta_description: '',
    support_phone: '', support_email: '',
    hide_menu_items: [], rename_menu_items: {},
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [activeTab, setActiveTab] = useState('colors');

  useEffect(() => { fetchBranding(); }, []);

  async function fetchBranding() {
    try {
      const r = await axios.get(`${API_BASE}/tenant/branding`);
      setForm(f => ({ ...f, ...r.data }));
    } catch {}
    setLoading(false);
  }

  async function save() {
    setSaving(true);
    try {
      await axios.patch(`${API_BASE}/tenant/branding`, form);
      applyTheme(form);
      setMsg('Сохранено ✓');
      setTimeout(() => setMsg(''), 3000);
    } catch (e) {
      setMsg('Ошибка: ' + (e.response?.data?.detail || e.message));
    }
    setSaving(false);
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const TABS = [
    { id: 'colors', label: 'Цвета и шрифт' },
    { id: 'identity', label: 'Бренд' },
    { id: 'seo', label: 'SEO & Meta' },
    { id: 'domain', label: 'Домен' },
    { id: 'nav', label: 'Навигация' },
  ];

  if (loading) return <div style={styles.loading}>Загрузка...</div>;

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <h2 style={styles.title}>Брендинг & White-Label</h2>
        <div style={styles.previewBar}>
          <span style={{ background: form.primary_color, ...styles.swatch }} title="Primary" />
          <span style={{ background: form.secondary_color, ...styles.swatch }} title="Secondary" />
          <span style={{ background: form.sidebar_color, ...styles.swatch }} title="Sidebar" />
          <span style={{ background: form.bg_color, ...styles.swatch, border: '1px solid #ddd' }} title="BG" />
        </div>
        <button onClick={save} disabled={saving} style={styles.saveBtn}>
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>
      {msg && <div style={{ ...styles.msg, background: msg.startsWith('Ошибка') ? '#fde8e8' : '#e8f5e9' }}>{msg}</div>}

      <div style={styles.tabs}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ ...styles.tab, ...(activeTab === t.id ? styles.tabActive : {}) }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={styles.content}>
        {activeTab === 'colors' && (
          <div style={styles.grid}>
            {[
              ['primary_color', 'Основной цвет'],
              ['secondary_color', 'Вторичный цвет'],
              ['sidebar_color', 'Цвет сайдбара'],
              ['bg_color', 'Фоновый цвет'],
            ].map(([key, label]) => (
              <div key={key} style={styles.field}>
                <label style={styles.label}>{label}</label>
                <div style={styles.colorRow}>
                  <input type="color" value={form[key] || '#ffffff'}
                    onChange={e => set(key, e.target.value)} style={styles.colorPicker} />
                  <input type="text" value={form[key] || ''} onChange={e => set(key, e.target.value)}
                    style={styles.colorInput} placeholder="#000000" />
                </div>
              </div>
            ))}
            <div style={styles.field}>
              <label style={styles.label}>Шрифт</label>
              <select value={form.font_family} onChange={e => set('font_family', e.target.value)} style={styles.select}>
                {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
        )}

        {activeTab === 'identity' && (
          <div style={styles.grid}>
            {[
              ['brand_name', 'Название бренда'],
              ['logo_url', 'URL логотипа'],
              ['favicon_url', 'URL favicon'],
              ['og_image_url', 'OG Image URL'],
              ['footer_text', 'Текст в подвале'],
              ['support_phone', 'Телефон поддержки'],
              ['support_email', 'Email поддержки'],
            ].map(([key, label]) => (
              <div key={key} style={styles.field}>
                <label style={styles.label}>{label}</label>
                <input type="text" value={form[key] || ''} onChange={e => set(key, e.target.value)}
                  style={styles.input} />
              </div>
            ))}
            {form.logo_url && (
              <div style={styles.field}>
                <label style={styles.label}>Превью логотипа</label>
                <img src={form.logo_url} alt="logo" style={{ maxHeight: 60, maxWidth: 200, borderRadius: 4 }} />
              </div>
            )}
          </div>
        )}

        {activeTab === 'seo' && (
          <div style={styles.grid}>
            <div style={styles.field}>
              <label style={styles.label}>Meta Title</label>
              <input value={form.meta_title || ''} onChange={e => set('meta_title', e.target.value)} style={styles.input} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Meta Description</label>
              <textarea value={form.meta_description || ''} onChange={e => set('meta_description', e.target.value)}
                style={{ ...styles.input, height: 80, resize: 'vertical' }} />
            </div>
          </div>
        )}

        {activeTab === 'domain' && (
          <div>
            <div style={styles.field}>
              <label style={styles.label}>Custom Domain (CNAME)</label>
              <input value={form.custom_domain || ''} onChange={e => set('custom_domain', e.target.value)}
                style={styles.input} placeholder="crm.myclinic.com" />
              <div style={styles.hint}>
                Укажите CNAME запись на <b>клиниксеть.рф</b>. Статус проверки:{' '}
                <span style={{ color: form.domain_verified ? '#4caf50' : '#f44336' }}>
                  {form.domain_verified ? '✓ Подтверждён' : '✗ Не проверен'}
                </span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'nav' && (
          <div>
            <p style={styles.hint}>Скрытые пункты меню (slug через запятую):</p>
            <input
              value={(form.hide_menu_items || []).join(', ')}
              onChange={e => set('hide_menu_items', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
              style={styles.input}
              placeholder="analytics, billing"
            />
            <p style={{ ...styles.hint, marginTop: 16 }}>Переименование пунктов (JSON): </p>
            <textarea
              value={JSON.stringify(form.rename_menu_items || {}, null, 2)}
              onChange={e => { try { set('rename_menu_items', JSON.parse(e.target.value)); } catch {} }}
              style={{ ...styles.input, height: 100, fontFamily: 'monospace', resize: 'vertical' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  wrap: { padding: 24, maxWidth: 900 },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
  title: { margin: 0, fontSize: 20, fontWeight: 700, flex: 1 },
  previewBar: { display: 'flex', gap: 6 },
  swatch: { display: 'inline-block', width: 28, height: 28, borderRadius: 6, cursor: 'default' },
  saveBtn: { padding: '8px 20px', background: '#0097A7', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 },
  msg: { padding: '8px 16px', borderRadius: 8, marginBottom: 12, fontSize: 14 },
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid #e0e0e0', marginBottom: 24 },
  tab: { padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer', color: '#555', borderBottom: '2px solid transparent', marginBottom: -1 },
  tabActive: { color: '#0097A7', borderBottom: '2px solid #0097A7', fontWeight: 600 },
  content: {},
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 13, fontWeight: 600, color: '#555' },
  input: { padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, outline: 'none' },
  select: { padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 },
  colorRow: { display: 'flex', gap: 8, alignItems: 'center' },
  colorPicker: { width: 40, height: 36, border: 'none', borderRadius: 6, cursor: 'pointer', padding: 0 },
  colorInput: { flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 },
  hint: { fontSize: 12, color: '#888', margin: '4px 0 0' },
  loading: { padding: 40, textAlign: 'center', color: '#888' },
};
