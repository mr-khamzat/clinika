/**
 * HeroChatDemo — анимированный phone-mockup для hero-секции Landing.
 *
 * Циклически проигрывает 3 сцены, иллюстрируя ключевые сценарии SaaS:
 *   1. ONLINE-ЗАПИСЬ          — пациент → клиника → подтверждение → карточка приёма
 *   2. АВТО-НАПОМИНАНИЕ        — клиника → пациент → карточка с адресом
 *   3. РЕЗУЛЬТАТЫ АНАЛИЗОВ     — клиника → карточка-PDF → повторная запись
 *
 * Каждая сцена:
 *   • меняет акцентный цвет (бирюза → синий → фиолет)
 *   • показывает свою итоговую карточку (appointment / map / lab)
 *   • плавно фейдится при смене (key={sceneIdx} на messages-контейнере)
 *
 * Над чатом — табы-индикаторы 1/2/3 с прогресс-баром активной сцены.
 *
 * Стек: чистый React + CSS keyframes. Никаких сторонних библиотек.
 */
import { useEffect, useState } from 'react'

const SCENES = [
  {
    id: 'booking',
    title: 'Запись',
    accent: '#0097A7',
    accentDark: '#0A2342',
    steps: [
      { type: 'msg-in',    text: 'Можно записаться к терапевту?', delay: 700 },
      { type: 'typing-in', delay: 1300 },
      { type: 'msg-out',   text: 'Конечно! Свободен Иванов И.И. — завтра в 14:30. Записать?', delay: 1300 },
      { type: 'msg-in',    text: '✓ Записать', delay: 900 },
      { type: 'card',      cardType: 'appointment', delay: 1400 },
    ],
    holdMs: 2200,
  },
  {
    id: 'reminder',
    title: 'Напоминание',
    accent: '#1565C0',
    accentDark: '#0A2342',
    steps: [
      { type: 'msg-out',   text: '🔔 Напоминаем: завтра в 14:30 — Иванов И.И., каб. 204', delay: 700 },
      { type: 'msg-in',    text: 'Подтверждаю, буду', delay: 1400 },
      { type: 'typing-in', delay: 1100 },
      { type: 'msg-out',   text: 'Отлично! Адрес и маршрут ↓', delay: 1100 },
      { type: 'card',      cardType: 'map', delay: 1300 },
    ],
    holdMs: 2200,
  },
  {
    id: 'lab',
    title: 'Анализы',
    accent: '#7C3AED',
    accentDark: '#3B0764',
    steps: [
      { type: 'msg-out',   text: '📋 Готовы результаты анализов', delay: 700 },
      { type: 'card',      cardType: 'lab', delay: 1300 },
      { type: 'msg-in',    text: 'Спасибо! Записать на повторный?', delay: 1400 },
      { type: 'typing-in', delay: 1100 },
      { type: 'msg-out',   text: '✓ Записал: 25 мая, 11:00', delay: 1200 },
    ],
    holdMs: 2400,
  },
]

const EXIT_MS = 480

export default function HeroChatDemo() {
  const [sceneIdx, setSceneIdx] = useState(0)
  const [visibleSteps, setVisibleSteps] = useState(0)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer

    const wait = (ms) => new Promise((r) => { timer = setTimeout(r, ms) })

    const playCycle = async () => {
      let s = 0
      while (!cancelled) {
        setExiting(false)
        setSceneIdx(s)
        setVisibleSteps(0)
        await wait(500)
        if (cancelled) return

        const scene = SCENES[s]
        for (let i = 0; i < scene.steps.length; i++) {
          await wait(scene.steps[i].delay)
          if (cancelled) return
          setVisibleSteps(i + 1)
        }
        await wait(scene.holdMs)
        if (cancelled) return
        setExiting(true)
        await wait(EXIT_MS)
        s = (s + 1) % SCENES.length
      }
    }

    playCycle()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  const scene = SCENES[sceneIdx]
  const totalSteps = scene.steps.length

  return (
    <div
      className="ks-hero-demo"
      style={{
        '--ks-accent': scene.accent,
        '--ks-accent-dark': scene.accentDark,
      }}
    >
      <style>{HERO_DEMO_CSS}</style>

      {/* Декоративные orb'ы за телефоном */}
      <div className="ks-hero-demo-bg" aria-hidden>
        <div className="ks-hero-demo-orb ks-hero-demo-orb-1" />
        <div className="ks-hero-demo-orb ks-hero-demo-orb-2" />
      </div>

      {/* Phone frame */}
      <div className="ks-phone" aria-hidden="true">
        <div className="ks-phone-notch" />
        <div className="ks-phone-screen">
          {/* Status bar */}
          <div className="ks-phone-status">
            <span className="ks-phone-time">14:23</span>
            <div className="ks-phone-icons">
              <span className="ks-phone-signal" />
              <span className="ks-phone-wifi" />
              <span className="ks-phone-battery" />
            </div>
          </div>

          {/* Chat header */}
          <div className="ks-phone-header">
            <div className="ks-phone-back">←</div>
            <div className="ks-phone-avatar">КС</div>
            <div className="ks-phone-header-info">
              <div className="ks-phone-header-name">Клиника КлиникСеть</div>
              <div className="ks-phone-header-status">● онлайн · ср.ответ 3 мин</div>
            </div>
            <div className="ks-phone-call">📞</div>
          </div>

          {/* Scene tabs */}
          <div className="ks-phone-scenes">
            {SCENES.map((s, i) => {
              const isActive = i === sceneIdx
              const progress = isActive ? Math.min(visibleSteps / totalSteps, 1) : 0
              return (
                <div
                  key={s.id}
                  className={`ks-phone-scene-tab ${isActive ? 'is-active' : ''}`}
                >
                  <span className="ks-phone-scene-tab-num">{i + 1}</span>
                  <span className="ks-phone-scene-tab-label">{s.title}</span>
                  {isActive && (
                    <span
                      className="ks-phone-scene-tab-bar"
                      style={{ transform: `scaleX(${progress})` }}
                    />
                  )}
                </div>
              )
            })}
          </div>

          {/* Messages */}
          <div
            key={`scene-${sceneIdx}`}
            className={`ks-phone-messages ${exiting ? 'is-exiting' : ''}`}
          >
            {scene.steps.map((step, i) => {
              if (visibleSteps <= i) return null
              if (step.type === 'msg-in') {
                return (
                  <div key={i} className="ks-msg ks-msg-in ks-msg-anim">
                    <div className="ks-msg-bubble">{step.text}</div>
                    <div className="ks-msg-time">14:2{3 + i}</div>
                  </div>
                )
              }
              if (step.type === 'typing-in') {
                return (
                  <div key={i} className="ks-msg ks-msg-in ks-msg-anim">
                    <div className="ks-msg-bubble ks-msg-typing">
                      <span /><span /><span />
                    </div>
                  </div>
                )
              }
              if (step.type === 'msg-out') {
                return (
                  <div key={i} className="ks-msg ks-msg-out ks-msg-anim">
                    <div className="ks-msg-bubble">{step.text}</div>
                    <div className="ks-msg-time">14:2{4 + i} ✓✓</div>
                  </div>
                )
              }
              if (step.type === 'card') {
                return (
                  <div key={i} className="ks-msg ks-msg-out ks-msg-anim ks-msg-card-wrap">
                    {step.cardType === 'appointment' && <AppointmentCard />}
                    {step.cardType === 'map' && <MapCard />}
                    {step.cardType === 'lab' && <LabCard />}
                  </div>
                )
              }
              return null
            })}
          </div>

          {/* Input bar */}
          <div className="ks-phone-input">
            <span className="ks-phone-input-attach">📎</span>
            <div className="ks-phone-input-field">Сообщение…</div>
            <span className="ks-phone-input-send">▶</span>
          </div>
        </div>
      </div>

      {/* Floating annotations */}
      <div className="ks-hero-anno ks-hero-anno-1">
        <span className="ks-hero-anno-dot" />
        SLA-эскалация: 15 мин → reg, 30 → manager
      </div>
      <div className="ks-hero-anno ks-hero-anno-2">
        <span className="ks-hero-anno-dot ks-hero-anno-dot-blue" />
        Запись попадает в МИС Renovatio автоматически
      </div>
    </div>
  )
}

/* ============================================================
   Карточки итогового действия — по одной на сцену
   ============================================================ */

function AppointmentCard() {
  return (
    <div className="ks-card ks-card-appt">
      <div className="ks-card-header">
        <span className="ks-card-icon">📅</span>
        <span className="ks-card-title">Приём оформлен</span>
      </div>
      <div className="ks-card-line">Терапевт · Иванов И.И.</div>
      <div className="ks-card-line ks-card-line-strong">Завтра, 14:30</div>
      <div className="ks-card-qr">
        <svg width="44" height="44" viewBox="0 0 40 40">
          {[...Array(7)].map((_, row) => [...Array(7)].map((_, col) => {
            const fill =
              ((row * 11 + col * 7) % 3 === 0) ||
              (row === 0 && col < 2) || (row < 2 && col === 0) ||
              (row === 6 && col === 6)
            return fill ? (
              <rect
                key={`${row}-${col}`}
                x={4 + col * 4.5}
                y={4 + row * 4.5}
                width="4"
                height="4"
                fill="#0F172A"
              />
            ) : null
          }))}
        </svg>
      </div>
    </div>
  )
}

function MapCard() {
  return (
    <div className="ks-card ks-card-map">
      <div className="ks-card-header">
        <span className="ks-card-icon">📍</span>
        <span className="ks-card-title">Маршрут построен</span>
      </div>
      <div className="ks-map-mini" aria-hidden>
        <div className="ks-map-grid" />
        <svg className="ks-map-route" viewBox="0 0 200 80" preserveAspectRatio="none">
          <path
            d="M 10 60 Q 50 60, 70 40 T 130 30 T 190 18"
            fill="none"
            stroke="var(--ks-accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="4 4"
          />
        </svg>
        <span className="ks-map-pin ks-map-pin-start" />
        <span className="ks-map-pin ks-map-pin-end">
          <span className="ks-map-pin-dot" />
        </span>
      </div>
      <div className="ks-card-line">ул. Ленина, 24 · каб. 204</div>
      <div className="ks-card-line ks-card-line-strong">12 мин на машине</div>
    </div>
  )
}

function LabCard() {
  return (
    <div className="ks-card ks-card-lab">
      <div className="ks-card-header">
        <span className="ks-card-icon">🧪</span>
        <span className="ks-card-title">Анализы готовы</span>
      </div>
      <div className="ks-lab-rows">
        <LabRow name="Гемоглобин" value="142 г/л" ok />
        <LabRow name="Лейкоциты" value="6.4 ×10⁹/л" ok />
        <LabRow name="СОЭ" value="9 мм/ч" ok />
      </div>
      <div className="ks-card-line ks-card-line-strong">Все показатели в норме</div>
      <button type="button" className="ks-card-pdf" tabIndex={-1}>
        <span>📄</span> Скачать PDF
      </button>
    </div>
  )
}

function LabRow({ name, value, ok }) {
  return (
    <div className="ks-lab-row">
      <span className="ks-lab-row-name">{name}</span>
      <span className="ks-lab-row-value">{value}</span>
      <span className={`ks-lab-row-mark ${ok ? 'is-ok' : ''}`}>{ok ? '✓' : '!'}</span>
    </div>
  )
}

const HERO_DEMO_CSS = `
.ks-hero-demo {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 560px;
  padding: 24px;
  perspective: 1200px;
}

.ks-hero-demo-bg {
  position: absolute; inset: 0;
  pointer-events: none;
  overflow: hidden;
  border-radius: 24px;
}
.ks-hero-demo-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: .45;
  transition: background 1.2s ease;
}
.ks-hero-demo-orb-1 {
  width: 280px; height: 280px;
  background: radial-gradient(circle, var(--ks-accent) 0%, transparent 70%);
  top: 10%; left: 5%;
  animation: ks-orb-float-a 14s ease-in-out infinite;
}
.ks-hero-demo-orb-2 {
  width: 220px; height: 220px;
  background: radial-gradient(circle, var(--ks-accent-dark) 0%, transparent 70%);
  bottom: 5%; right: 8%;
  animation: ks-orb-float-b 18s ease-in-out infinite;
}

@keyframes ks-orb-float-a {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50%      { transform: translate(40px, -30px) scale(1.15); }
}
@keyframes ks-orb-float-b {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50%      { transform: translate(-30px, 20px) scale(1.1); }
}

.ks-phone {
  position: relative;
  width: 320px;
  height: 600px;
  background: #0F172A;
  border-radius: 38px;
  padding: 12px;
  box-shadow:
    0 30px 80px rgba(15,23,42,.4),
    0 10px 30px color-mix(in srgb, var(--ks-accent) 35%, transparent),
    inset 0 0 0 2px rgba(255,255,255,.06);
  transform: rotateY(-8deg) rotateX(2deg);
  transition: transform .6s cubic-bezier(.2,.8,.2,1), box-shadow 1.2s ease;
}
.ks-hero-demo:hover .ks-phone {
  transform: rotateY(0deg) rotateX(0deg);
}

.ks-phone-notch {
  position: absolute;
  top: 12px; left: 50%; transform: translateX(-50%);
  width: 90px; height: 22px;
  background: #0F172A;
  border-radius: 0 0 14px 14px;
  z-index: 2;
}

.ks-phone-screen {
  position: relative;
  width: 100%; height: 100%;
  background: linear-gradient(180deg, #f8fafc 0%, #eef2f6 100%);
  border-radius: 28px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ks-phone-status {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 22px 4px;
  font-size: 11px; font-weight: 700; color: #0F172A;
}
.ks-phone-icons { display: flex; gap: 4px; align-items: center; }
.ks-phone-signal, .ks-phone-wifi, .ks-phone-battery {
  display: inline-block; width: 12px; height: 8px;
  background: #0F172A; border-radius: 2px;
}
.ks-phone-battery { width: 18px; height: 9px; }

.ks-phone-header {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
}
.ks-phone-back { font-size: 18px; color: var(--ks-accent); cursor: pointer; transition: color .6s ease; }
.ks-phone-avatar {
  width: 36px; height: 36px; border-radius: 12px;
  background: linear-gradient(135deg, var(--ks-accent) 0%, var(--ks-accent-dark) 100%);
  color: #fff; font-size: 12px; font-weight: 700;
  display: grid; place-items: center;
  transition: background 1.2s ease;
}
.ks-phone-header-info { flex: 1; min-width: 0; }
.ks-phone-header-name {
  font-size: 13px; font-weight: 700; color: #0F172A; line-height: 1.2;
}
.ks-phone-header-status {
  font-size: 10px; color: #22c55e; font-weight: 600; line-height: 1.2; margin-top: 2px;
}
.ks-phone-call { font-size: 16px; opacity: .7; }

/* Scene tabs */
.ks-phone-scenes {
  display: flex;
  gap: 6px;
  padding: 8px 12px 6px;
  background: linear-gradient(180deg, #fff 0%, transparent 100%);
  border-bottom: 1px solid #eef2f6;
}
.ks-phone-scene-tab {
  position: relative;
  flex: 1;
  display: flex; align-items: center; gap: 5px;
  padding: 5px 8px 6px;
  background: #f1f5f9;
  border-radius: 8px;
  font-size: 10.5px;
  font-weight: 600;
  color: #94a3b8;
  overflow: hidden;
  transition: background .5s ease, color .5s ease;
}
.ks-phone-scene-tab.is-active {
  background: color-mix(in srgb, var(--ks-accent) 14%, #fff);
  color: var(--ks-accent-dark);
}
.ks-phone-scene-tab-num {
  display: grid; place-items: center;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: #cbd5e1;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  flex-shrink: 0;
  transition: background .5s ease;
}
.ks-phone-scene-tab.is-active .ks-phone-scene-tab-num {
  background: var(--ks-accent);
}
.ks-phone-scene-tab-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ks-phone-scene-tab-bar {
  position: absolute;
  left: 0; bottom: 0;
  width: 100%;
  height: 2px;
  background: var(--ks-accent);
  transform-origin: left center;
  transform: scaleX(0);
  transition: transform .35s cubic-bezier(.2,.8,.2,1);
}

.ks-phone-messages {
  flex: 1;
  padding: 14px 14px 8px;
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 10px;
  background-image: radial-gradient(rgba(15,23,42,.05) 1px, transparent 1px);
  background-size: 20px 20px;
  animation: ks-scene-in .5s cubic-bezier(.2,.8,.2,1);
}
.ks-phone-messages.is-exiting {
  animation: ks-scene-out .45s cubic-bezier(.4,0,.6,1) forwards;
}
@keyframes ks-scene-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes ks-scene-out {
  from { opacity: 1; transform: translateY(0)   scale(1); filter: blur(0); }
  to   { opacity: 0; transform: translateY(-6px) scale(.985); filter: blur(2px); }
}

.ks-msg {
  display: flex; flex-direction: column; gap: 2px;
  max-width: 82%;
}
.ks-msg-in  { align-self: flex-start; }
.ks-msg-out { align-self: flex-end; align-items: flex-end; }

.ks-msg-anim {
  animation: ks-msg-in-anim .42s cubic-bezier(.2,.8,.2,1);
}
@keyframes ks-msg-in-anim {
  from { opacity: 0; transform: translateY(8px) scale(.95); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}

.ks-msg-bubble {
  padding: 8px 12px;
  border-radius: 16px;
  font-size: 12.5px; line-height: 1.4;
  word-break: break-word;
  box-shadow: 0 1px 2px rgba(15,23,42,.06);
}
.ks-msg-in .ks-msg-bubble {
  background: #fff;
  color: #0F172A;
  border-top-left-radius: 4px;
}
.ks-msg-out .ks-msg-bubble {
  background: linear-gradient(135deg, var(--ks-accent) 0%, var(--ks-accent-dark) 100%);
  color: #fff;
  border-top-right-radius: 4px;
  transition: background 1.2s ease;
}

.ks-msg-time { font-size: 9px; color: #94a3b8; padding: 0 6px; }

.ks-msg-typing { display: inline-flex; gap: 4px; padding: 12px 14px; }
.ks-msg-typing span {
  width: 6px; height: 6px; border-radius: 50%;
  background: #94a3b8;
  animation: ks-typing-bounce 1.4s ease-in-out infinite;
}
.ks-msg-typing span:nth-child(2) { animation-delay: .2s; }
.ks-msg-typing span:nth-child(3) { animation-delay: .4s; }
@keyframes ks-typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: .4; }
  30%           { transform: translateY(-4px); opacity: 1; }
}

/* Cards (общая база + индивидуальные акценты) */
.ks-msg-card-wrap .ks-card { animation: ks-card-pop .6s cubic-bezier(.34,1.56,.64,1); }
@keyframes ks-card-pop {
  0%   { opacity: 0; transform: scale(.85) translateY(8px); }
  60%  { opacity: 1; transform: scale(1.02) translateY(0); }
  100% { opacity: 1; transform: scale(1)    translateY(0); }
}

.ks-card {
  min-width: 224px;
  background: linear-gradient(135deg, #fff 0%, #f8fafc 100%);
  border: 1px solid color-mix(in srgb, var(--ks-accent) 25%, transparent);
  border-radius: 14px;
  padding: 10px 12px;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--ks-accent) 22%, transparent);
}

.ks-card-header {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 700; color: var(--ks-accent);
  text-transform: uppercase; letter-spacing: .04em;
  margin-bottom: 6px;
}
.ks-card-icon { font-size: 13px; }
.ks-card-line {
  font-size: 12px; color: #475569; margin: 2px 0;
}
.ks-card-line-strong {
  font-size: 14px; color: #0F172A; font-weight: 700; margin: 4px 0;
}
.ks-card-qr {
  display: flex; justify-content: center; margin-top: 6px;
  background: #fff; border-radius: 6px; padding: 4px;
}

/* Map mini-card */
.ks-map-mini {
  position: relative;
  height: 78px;
  border-radius: 10px;
  margin: 4px 0 8px;
  overflow: hidden;
  background: linear-gradient(135deg, #f1f5f9, #e2e8f0);
}
.ks-map-grid {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(15,23,42,.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(15,23,42,.08) 1px, transparent 1px);
  background-size: 14px 14px;
}
.ks-map-route { position: absolute; inset: 0; width: 100%; height: 100%; }
.ks-map-pin {
  position: absolute;
  width: 10px; height: 10px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(15,23,42,.3);
}
.ks-map-pin-start { left: 5%; bottom: 22%; background: #94a3b8; }
.ks-map-pin-end {
  right: 5%; top: 18%;
  background: var(--ks-accent);
  width: 14px; height: 14px;
  display: grid; place-items: center;
  animation: ks-pin-pulse 1.8s ease-in-out infinite;
}
.ks-map-pin-dot {
  width: 4px; height: 4px; border-radius: 50%;
  background: #fff;
}
@keyframes ks-pin-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ks-accent) 60%, transparent); }
  50%      { box-shadow: 0 0 0 6px color-mix(in srgb, var(--ks-accent) 0%, transparent); }
}

/* Lab card */
.ks-lab-rows {
  display: flex; flex-direction: column; gap: 3px;
  background: #fff;
  border-radius: 8px;
  padding: 6px 8px;
  margin: 4px 0 6px;
}
.ks-lab-row {
  display: grid;
  grid-template-columns: 1fr auto 16px;
  gap: 8px;
  align-items: center;
  font-size: 11.5px;
  padding: 2px 0;
}
.ks-lab-row-name { color: #475569; }
.ks-lab-row-value { color: #0F172A; font-weight: 600; font-variant-numeric: tabular-nums; }
.ks-lab-row-mark {
  width: 16px; height: 16px; border-radius: 50%;
  display: grid; place-items: center;
  font-size: 10px; font-weight: 700;
  background: #fee2e2; color: #dc2626;
}
.ks-lab-row-mark.is-ok { background: #dcfce7; color: #16a34a; }

.ks-card-pdf {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 4px;
  padding: 6px 10px;
  background: color-mix(in srgb, var(--ks-accent) 12%, #fff);
  border: 1px solid color-mix(in srgb, var(--ks-accent) 30%, transparent);
  border-radius: 999px;
  font-size: 11px; font-weight: 600;
  color: var(--ks-accent-dark);
  cursor: default;
}

/* Input */
.ks-phone-input {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px 14px;
  background: #fff;
  border-top: 1px solid #e2e8f0;
}
.ks-phone-input-attach { font-size: 16px; opacity: .5; }
.ks-phone-input-field {
  flex: 1;
  padding: 8px 12px;
  background: #f1f5f9;
  border-radius: 16px;
  font-size: 12px;
  color: #94a3b8;
}
.ks-phone-input-send {
  width: 32px; height: 32px;
  display: grid; place-items: center;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--ks-accent) 0%, var(--ks-accent-dark) 100%);
  color: #fff;
  font-size: 11px;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--ks-accent) 40%, transparent);
  transition: background 1.2s ease;
}

/* Annotations */
.ks-hero-anno {
  position: absolute;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 12px;
  background: rgba(255,255,255,.92);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(15,23,42,.08);
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  color: #475569;
  box-shadow: 0 8px 24px rgba(15,23,42,.12);
  white-space: nowrap;
  pointer-events: none;
  animation: ks-anno-float 4s ease-in-out infinite;
}
.ks-hero-anno-1 { top: 14%; left: -12%; }
.ks-hero-anno-2 { bottom: 18%; right: -10%; animation-delay: 2s; }

.ks-hero-anno-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 0 rgba(34,197,94,.5);
  animation: ks-anno-pulse 2s ease-in-out infinite;
}
.ks-hero-anno-dot-blue {
  background: #1565C0;
  animation: ks-anno-pulse-blue 2s ease-in-out infinite;
}
@keyframes ks-anno-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,.5); }
  50%      { box-shadow: 0 0 0 8px rgba(34,197,94,0); }
}
@keyframes ks-anno-pulse-blue {
  0%, 100% { box-shadow: 0 0 0 0 rgba(21,101,192,.5); }
  50%      { box-shadow: 0 0 0 8px rgba(21,101,192,0); }
}
@keyframes ks-anno-float {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-6px); }
}

@media (max-width: 880px) {
  .ks-hero-anno { display: none; }
  .ks-phone {
    width: 280px; height: 540px;
    transform: none;
  }
  .ks-phone-scene-tab-label { font-size: 9.5px; }
}
`
