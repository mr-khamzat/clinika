/**
 * ========================================
 * БЛОК: Доп. CSS для премиум-секций лендинга
 * ========================================
 * Подключается через <style>{LANDING_EXTRAS_CSS}</style> ПОСЛЕ основного LANDING_CSS.
 * ========================================
 */
export const LANDING_EXTRAS_CSS = `
/* === Social Proof === */
.ks-social-proof { padding-top: 32px; padding-bottom: 32px; }
.ks-sp-label {
  text-align: center; font-size: 12px; font-weight: 600;
  letter-spacing: 0.12em; text-transform: uppercase; color: var(--fg-3);
  margin-bottom: 22px;
}
.ks-sp-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px; max-width: 1120px; margin: 0 auto;
}
.ks-sp-item {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px;
  background: oklch(1 0 0 / 0.6);
  border: 1px solid var(--border);
  border-radius: 14px;
  backdrop-filter: blur(8px);
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
}
.ks-sp-item:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); border-color: var(--accent-line); }
.ks-sp-mark { color: var(--accent); font-size: 18px; }
.ks-sp-name { font-size: 14px; font-weight: 600; color: var(--fg); letter-spacing: -0.01em; }
.ks-sp-sub { font-size: 11px; color: var(--fg-3); margin-top: 2px; }

/* === Functional Showcase === */
.ks-fs { padding-top: 80px; padding-bottom: 80px; }
.ks-fs-list { display: grid; gap: 88px; margin-top: 56px; }
.ks-fs-row-wrap {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 56px;
  align-items: center;
}
.ks-fs-row-wrap.is-reverse { direction: rtl; }
.ks-fs-row-wrap.is-reverse > * { direction: ltr; }
.ks-fs-eyebrow { display: inline-flex; }
.ks-fs-h {
  font-size: clamp(26px, 3vw, 36px);
  line-height: 1.15;
  letter-spacing: -0.025em;
  font-weight: 600;
  margin: 14px 0 14px;
}
.ks-fs-p {
  font-size: 17px; line-height: 1.6; color: var(--fg-2);
  margin: 0 0 12px;
}
.ks-fs-feats {
  list-style: none; padding: 0; margin: 20px 0 18px;
  display: grid; gap: 8px;
}
.ks-fs-feats li {
  display: flex; align-items: flex-start; gap: 10px;
  font-size: 15px; color: var(--fg);
}
.ks-fs-check {
  flex-shrink: 0;
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--accent-soft); color: var(--accent);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700;
  margin-top: 1px;
}
.ks-fs-pills { display: flex; gap: 8px; flex-wrap: wrap; }
.ks-fs-pill {
  display: inline-flex; align-items: center; padding: 4px 10px;
  border-radius: 999px; font-size: 12px; font-weight: 600;
}
.ks-fs-pill-accent { background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent-line); }

/* мок-карточки: лёгкий 3D-tilt + sheen при hover */
.ks-fs-visual { position: relative; perspective: 1200px; }
.ks-fs-visual .ks-fs-mock {
  transform: translateZ(0) rotateX(0) rotateY(0);
  transition: transform 0.5s cubic-bezier(0.2, 0.7, 0.2, 1), box-shadow 0.5s ease;
  will-change: transform;
}
.ks-fs-visual:hover .ks-fs-mock {
  transform: translateY(-6px) rotateX(2deg) rotateY(-3deg);
  box-shadow:
    0 30px 70px oklch(0.18 0.014 220 / 0.18),
    0 8px 22px oklch(0.18 0.014 220 / 0.10);
}
.ks-fs-visual .ks-fs-mock::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(135deg, oklch(1 0 0 / 0) 30%, oklch(1 0 0 / 0.22) 50%, oklch(1 0 0 / 0) 70%);
  opacity: 0; transition: opacity 0.4s ease; mix-blend-mode: overlay;
  border-radius: inherit;
}
.ks-fs-visual:hover .ks-fs-mock::after { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .ks-fs-visual .ks-fs-mock,
  .ks-fs-visual:hover .ks-fs-mock { transform: none; transition: none; }
  .ks-fs-visual:hover .ks-fs-mock::after { opacity: 0; }
}

/* мок-карточки */
.ks-fs-mock {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow:
    0 20px 50px oklch(0.18 0.014 220 / 0.10),
    0 4px 14px oklch(0.18 0.014 220 / 0.06);
  overflow: hidden;
  min-height: 280px;
}
.ks-fs-mock::before {
  content: '';
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(ellipse 60% 50% at 90% -10%, oklch(0.94 0.06 240 / 0.4), transparent 60%),
    radial-gradient(ellipse 50% 50% at -10% 90%, oklch(0.96 0.05 200 / 0.35), transparent 60%);
}
.ks-fs-mock-head {
  position: relative;
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  background: oklch(1 0 0 / 0.55);
  backdrop-filter: blur(8px);
}
.ks-fs-mock-title { font-size: 13px; font-weight: 600; color: var(--fg); }
.ks-fs-mock-badge {
  font-size: 11px; font-weight: 600;
  padding: 3px 8px; border-radius: 999px;
  background: var(--good-soft); color: var(--good);
  border: 1px solid oklch(0.55 0.15 150 / 0.25);
}
.ks-fs-mock-badge-gold { background: oklch(0.62 0.13 75 / 0.10); color: var(--gold); border-color: oklch(0.62 0.13 75 / 0.25); }

/* Schedule mock */
.ks-fs-mock-rows { position: relative; padding: 10px 18px 18px; display: grid; gap: 6px; }
.ks-fs-row {
  display: grid; grid-template-columns: 56px 12px 1fr auto; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 10px; background: var(--bg-1);
  font-size: 13px;
}
.ks-fs-row-t { font-weight: 600; color: var(--fg); }
.ks-fs-row-dot { width: 8px; height: 8px; border-radius: 50%; }
.ks-fs-row-n { color: var(--fg-2); }
.ks-fs-row-r { font-size: 11px; color: var(--fg-3); text-transform: uppercase; letter-spacing: 0.04em; }

/* MedCard mock */
.ks-fs-mc-tabs { position: relative; display: flex; gap: 4px; padding: 12px 18px 0; }
.ks-fs-mc-tab { font-size: 13px; padding: 6px 12px; border-radius: 8px; color: var(--fg-3); }
.ks-fs-mc-tab.is-active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.ks-fs-mc-list { position: relative; padding: 14px 18px 18px; display: grid; gap: 6px; }
.ks-fs-mc-item {
  display: grid; grid-template-columns: 50px 1fr 1fr auto; gap: 12px; align-items: center;
  padding: 10px 12px; background: var(--bg-1); border-radius: 10px; font-size: 13px;
}
.ks-fs-mc-date { font-weight: 600; color: var(--fg); }
.ks-fs-mc-kind { color: var(--fg-2); }
.ks-fs-mc-doc { color: var(--fg-3); font-size: 12px; }
.ks-fs-mc-note { font-size: 11px; color: var(--good); font-weight: 600; }

/* Loyalty mock */
.ks-fs-loy { position: relative; padding: 22px; display: grid; gap: 16px; }
.ks-fs-loy-balance { text-align: center; padding: 14px 0; }
.ks-fs-loy-amount {
  font-size: 40px; font-weight: 600; letter-spacing: -0.03em;
  background: linear-gradient(120deg, var(--accent), oklch(0.62 0.15 220));
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
}
.ks-fs-loy-amount span { font-size: 24px; }
.ks-fs-loy-sub { font-size: 12px; color: var(--fg-3); }
.ks-fs-loy-bar { height: 8px; background: var(--bg-2); border-radius: 999px; overflow: hidden; }
.ks-fs-loy-bar span { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), oklch(0.62 0.15 220)); border-radius: 999px; }
.ks-fs-loy-line { font-size: 12px; color: var(--fg-3); text-align: center; margin-top: 6px; }
.ks-fs-loy-perks { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
.ks-fs-loy-chip {
  font-size: 11px; padding: 5px 10px; border-radius: 999px;
  background: var(--bg-1); color: var(--fg-2); border: 1px solid var(--border);
}

/* AI mock */
.ks-fs-ai { position: relative; padding: 18px; display: grid; gap: 14px; }
.ks-fs-ai-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ks-fs-ai-cell {
  padding: 12px; background: var(--bg-1); border-radius: 10px; border: 1px solid var(--border);
}
.ks-fs-ai-l { font-size: 11px; color: var(--fg-3); text-transform: uppercase; letter-spacing: 0.04em; }
.ks-fs-ai-v { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; margin-top: 4px; }
.ks-fs-ai-d { font-size: 12px; font-weight: 600; margin-top: 2px; }
.ks-fs-ai-d-good { color: var(--good); }
.ks-fs-ai-d-warn { color: var(--warn); }
.ks-fs-ai-insight {
  font-size: 13px; padding: 10px 14px; border-radius: 10px;
  background: var(--accent-soft); color: var(--accent);
  border: 1px solid var(--accent-line);
  display: flex; align-items: center; gap: 8px;
}
.ks-fs-ai-spark { font-size: 16px; }

/* Integrations mock */
.ks-fs-int-grid { position: relative; padding: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ks-fs-int-cell {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; background: var(--bg-1); border-radius: 10px; border: 1px solid var(--border);
}
.ks-fs-int-mark {
  width: 32px; height: 32px; border-radius: 8px;
  background: linear-gradient(135deg, var(--accent), oklch(0.62 0.15 220));
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 14px;
}
.ks-fs-int-n { font-size: 13px; font-weight: 600; }
.ks-fs-int-d { font-size: 11px; color: var(--fg-3); }

/* === Testimonials === */
.ks-tm { background: linear-gradient(180deg, transparent, oklch(0.96 0.01 220) 30%, transparent 100%); padding-top: 80px; padding-bottom: 80px; }
.ks-tm-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 40px; }
.ks-tm-card {
  position: relative;
  padding: 28px 26px 24px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  transition: transform 0.25s, box-shadow 0.25s, border-color 0.25s;
}
.ks-tm-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-md); border-color: var(--accent-line); }
.ks-tm-mark {
  position: absolute; top: 8px; left: 18px;
  font-size: 88px; line-height: 1; color: var(--accent-soft);
  font-family: Georgia, serif;
}
.ks-tm-text {
  position: relative;
  font-size: 16px; line-height: 1.55; color: var(--fg);
  margin: 12px 0 24px;
  font-weight: 500;
}
.ks-tm-foot { display: flex; align-items: center; gap: 12px; }
.ks-tm-avatar {
  width: 44px; height: 44px; border-radius: 50%;
  color: #fff; font-size: 14px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
}
.ks-tm-author { font-size: 14px; font-weight: 600; color: var(--fg); }
.ks-tm-role { font-size: 12px; color: var(--fg-3); }
.ks-tm-top {
  position: relative;
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 10px; min-height: 22px; margin-bottom: 6px;
}
.ks-tm-company {
  font-size: 11px; font-weight: 700; letter-spacing: 0.12em;
  padding: 4px 10px; border-radius: 999px;
  border: 1px solid currentColor; opacity: 0.85;
  background: oklch(1 0 0 / 0.5); backdrop-filter: blur(4px);
  white-space: nowrap;
}

/* === FAQ === */
.ks-faq { padding-top: 80px; padding-bottom: 80px; }
.ks-faq-list { max-width: 820px; margin: 40px auto 0; display: grid; gap: 12px; }
.ks-faq-item {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.ks-faq-item.is-open { border-color: var(--accent-line); box-shadow: var(--shadow-sm); }
.ks-faq-q {
  width: 100%; display: flex; justify-content: space-between; align-items: center;
  padding: 18px 22px;
  font-size: 16px; font-weight: 600; color: var(--fg);
  text-align: left;
  transition: background 0.15s;
}
.ks-faq-q:hover { background: var(--bg-1); }
.ks-faq-icon {
  flex-shrink: 0; margin-left: 16px;
  width: 28px; height: 28px; border-radius: 999px;
  background: var(--accent-soft); color: var(--accent);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 600;
}
.ks-faq-a {
  overflow: hidden;
  transition: max-height 0.32s ease, opacity 0.25s ease;
}
.ks-faq-a p {
  margin: 0;
  padding: 0 22px 20px;
  font-size: 15px; line-height: 1.6; color: var(--fg-2);
}

/* === CTA Newsletter === */
.ks-cta-final { padding: 60px 28px 80px; }
.ks-cta-card-pro {
  position: relative;
  max-width: 920px; margin: 0 auto;
  padding: 56px 40px;
  border-radius: 28px;
  background:
    radial-gradient(ellipse 80% 60% at 50% 0%, oklch(0.85 0.10 240 / 0.20), transparent 60%),
    linear-gradient(180deg, oklch(0.18 0.014 220), oklch(0.13 0.014 220));
  color: #fff;
  overflow: hidden;
  text-align: center;
  border: 1px solid oklch(1 0 0 / 0.08);
}
.ks-cta-glow {
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(ellipse 40% 40% at 20% 80%, oklch(0.55 0.16 240 / 0.4), transparent 60%),
    radial-gradient(ellipse 40% 40% at 80% 20%, oklch(0.62 0.15 220 / 0.4), transparent 60%);
}
.ks-cta-content { position: relative; z-index: 1; display: grid; gap: 12px; }
.ks-cta-card-pro h2 {
  font-size: clamp(28px, 4vw, 44px); line-height: 1.12;
  letter-spacing: -0.03em; font-weight: 600;
  margin: 0;
}
.ks-cta-card-pro p {
  font-size: 17px; line-height: 1.55; color: oklch(1 0 0 / 0.78);
  max-width: 560px; margin: 6px auto 18px;
}
.ks-cta-news {
  display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;
  margin-top: 14px;
}
.ks-cta-news-input {
  flex: 1; min-width: 240px; max-width: 360px;
  padding: 12px 16px; border-radius: 12px;
  background: oklch(1 0 0 / 0.08);
  border: 1px solid oklch(1 0 0 / 0.18);
  color: #fff; font-size: 15px;
  outline: none;
  transition: border-color 0.15s, background 0.15s;
}
.ks-cta-news-input::placeholder { color: oklch(1 0 0 / 0.55); }
.ks-cta-news-input:focus { border-color: oklch(0.78 0.15 240); background: oklch(1 0 0 / 0.12); }
.ks-cta-news-btn {
  padding: 12px 22px; border-radius: 12px;
  background: linear-gradient(135deg, oklch(0.75 0.18 240), oklch(0.65 0.18 220));
  color: #fff; font-size: 15px; font-weight: 600;
  border: 1px solid oklch(1 0 0 / 0.18);
  transition: transform 0.15s, box-shadow 0.15s;
}
.ks-cta-news-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 10px 24px oklch(0 0 0 / 0.25); }
.ks-cta-news-ok {
  font-size: 14px; color: oklch(0.85 0.13 145);
  padding: 10px 16px; border-radius: 10px;
  background: oklch(0.55 0.15 150 / 0.15);
  border: 1px solid oklch(0.55 0.15 150 / 0.30);
}
.ks-cta-trust-row {
  display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
  font-size: 13px; color: oklch(1 0 0 / 0.55); margin-top: 14px;
}

/* === Footer соцсети === */
.ks-footer-social { display: flex; gap: 8px; margin-top: 16px; }
.ks-footer-social a {
  width: 36px; height: 36px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--bg-1); color: var(--fg-2);
  border: 1px solid var(--border);
  transition: all 0.15s;
}
.ks-footer-social a:hover { background: var(--accent); color: #fff; border-color: var(--accent); transform: translateY(-1px); }

/* === Footer Trust Pillars === */
.ks-footer-pillars {
  max-width: 1240px; margin: 28px auto 0;
  padding: 18px 24px;
  display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px;
  background: oklch(1 0 0 / 0.55); backdrop-filter: blur(8px);
  border: 1px solid var(--border);
  border-radius: 14px;
}
.ks-footer-pillar {
  display: flex; align-items: center; gap: 10px;
  font-size: 13px; color: var(--fg-2);
}
.ks-footer-pillar-mark {
  width: 30px; height: 30px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--accent-soft); color: var(--accent);
  font-weight: 700; font-size: 13px;
  border: 1px solid var(--accent-line);
}
.ks-footer-pillar strong { color: var(--fg); font-weight: 600; }
.ks-footer-pillar small { color: var(--fg-3); font-size: 11px; display: block; margin-top: 1px; }

/* === Hero trust chips (premium-полировка) === */
.ks-hero-trust-chips {
  display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px;
}
.ks-hero-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 999px;
  background: oklch(1 0 0 / 0.6); border: 1px solid var(--border);
  font-size: 12px; font-weight: 600; color: var(--fg-2);
  backdrop-filter: blur(6px);
  transition: transform 0.15s, border-color 0.15s, color 0.15s;
}
.ks-hero-chip:hover { transform: translateY(-1px); border-color: var(--accent-line); color: var(--accent); }
.ks-hero-chip-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--good); }

/* === Focus-visible премиум-кольца (a11y) === */
.ks-btn-primary:focus-visible,
.ks-btn-secondary:focus-visible,
.ks-btn-ghost:focus-visible,
.ks-btn-cta-primary:focus-visible,
.ks-btn-cta-secondary:focus-visible,
.ks-price-cta:focus-visible,
.ks-nav-cta:focus-visible,
.ks-nav-link:focus-visible,
.ks-roles-tab:focus-visible,
.ks-faq-q:focus-visible,
.ks-cta-news-btn:focus-visible,
.ks-cta-news-input:focus-visible,
.ks-footer-social a:focus-visible,
.ks-sp-item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft), 0 0 0 4px var(--accent);
}

/* === Mobile === */
@media (max-width: 900px) {
  .ks-fs-row-wrap { grid-template-columns: 1fr; gap: 28px; }
  .ks-fs-row-wrap.is-reverse { direction: ltr; }
  .ks-fs-row-wrap.is-reverse .ks-fs-visual { order: -1; }
  .ks-fs-list { gap: 56px; }
  .ks-tm-grid { grid-template-columns: 1fr; }
  .ks-cta-card-pro { padding: 40px 24px; border-radius: 22px; }
  .ks-cta-news-input { min-width: unset; width: 100%; max-width: unset; }
  .ks-cta-news-btn { width: 100%; }
}
@media (max-width: 600px) {
  .ks-fs-h { font-size: 24px; }
  .ks-fs-p { font-size: 15px; }
  .ks-fs-ai-grid { grid-template-columns: 1fr; }
  .ks-fs-int-grid { grid-template-columns: 1fr; }
  .ks-sp-grid { grid-template-columns: repeat(2, 1fr); }
  .ks-footer-pillars { padding: 14px 16px; gap: 12px; }
  .ks-footer-pillar { font-size: 12px; }
}
`
