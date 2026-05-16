/**
 * HeroChatDemo — анимированный чат-диалог в виде phone-mockup для hero-секции Landing.
 *
 * Цикл 4 шага:
 *   1. Пациент пишет «Здравствуйте, можно записаться к терапевту?»
 *   2. typing-indicator «Клиника печатает…»
 *   3. Регистратор отвечает «Конечно! Свободен Иванов И.И. — завтра в 14:30. Записать?»
 *   4. Пациент жмёт «✓ Записать»  →  карточка приёма с QR
 *
 * После всех шагов — пауза 3 с, затем цикл повторяется.
 *
 * Стек: чистый React + CSS keyframes. Никаких сторонних библиотек.
 */
import { useEffect, useState } from 'react'

const STEPS = [
  // type: 'msg-in' | 'typing-in' | 'msg-out' | 'card'
  { type: 'msg-in',    text: 'Здравствуйте, можно записаться к терапевту?', delay: 800 },
  { type: 'typing-in', delay: 1400 },
  { type: 'msg-out',   text: 'Конечно! Свободен Иванов И.И. — завтра в 14:30. Записать?', delay: 1200 },
  { type: 'msg-in',    text: '✓ Записать', delay: 900, short: true },
  { type: 'card',      delay: 1500 },
]

export default function HeroChatDemo() {
  const [visibleSteps, setVisibleSteps] = useState(0)

  useEffect(() => {
    let cancelled = false
    let timer

    const playCycle = async () => {
      while (!cancelled) {
        setVisibleSteps(0)
        for (let i = 0; i < STEPS.length; i++) {
          if (cancelled) return
          await new Promise(r => { timer = setTimeout(r, STEPS[i].delay) })
          if (cancelled) return
          setVisibleSteps(i + 1)
        }
        // Пауза перед перезапуском цикла
        await new Promise(r => { timer = setTimeout(r, 3500) })
      }
    }
    playCycle()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  return (
    <div className="ks-hero-demo">
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

          {/* Messages */}
          <div className="ks-phone-messages">
            {STEPS.map((step, i) => {
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
                    <div className="ks-msg-time">14:25 ✓✓</div>
                  </div>
                )
              }
              if (step.type === 'card') {
                return (
                  <div key={i} className="ks-msg ks-msg-out ks-msg-anim">
                    <div className="ks-appt-card">
                      <div className="ks-appt-card-header">
                        <span className="ks-appt-card-icon">📅</span>
                        <span className="ks-appt-card-title">Приём оформлен</span>
                      </div>
                      <div className="ks-appt-card-line">Терапевт · Иванов И.И.</div>
                      <div className="ks-appt-card-line ks-appt-card-line-strong">Завтра, 14:30</div>
                      <div className="ks-appt-card-qr">
                        <svg width="40" height="40" viewBox="0 0 40 40">
                          {/* Simplified QR pattern */}
                          {[...Array(7)].map((_, row) => [...Array(7)].map((_, col) => {
                            const fill = ((row * 11 + col * 7) % 3 === 0) ||
                                         (row === 0 && col < 2) || (row < 2 && col === 0) ||
                                         (row === 6 && col === 6)
                            return fill ? (
                              <rect key={`${row}-${col}`} x={4 + col * 4.5} y={4 + row * 4.5}
                                    width="4" height="4" fill="#0F172A" />
                            ) : null
                          }))}
                        </svg>
                      </div>
                    </div>
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
}
.ks-hero-demo-orb-1 {
  width: 280px; height: 280px;
  background: radial-gradient(circle, #0097A7 0%, transparent 70%);
  top: 10%; left: 5%;
  animation: ks-orb-float-a 14s ease-in-out infinite;
}
.ks-hero-demo-orb-2 {
  width: 220px; height: 220px;
  background: radial-gradient(circle, #1565C0 0%, transparent 70%);
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
    0 10px 30px rgba(0,151,167,.25),
    inset 0 0 0 2px rgba(255,255,255,.06);
  transform: rotateY(-8deg) rotateX(2deg);
  transition: transform .6s cubic-bezier(.2,.8,.2,1);
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
.ks-phone-back { font-size: 18px; color: #0097A7; cursor: pointer; }
.ks-phone-avatar {
  width: 36px; height: 36px; border-radius: 12px;
  background: linear-gradient(135deg, #0097A7 0%, #1565C0 100%);
  color: #fff; font-size: 12px; font-weight: 700;
  display: grid; place-items: center;
}
.ks-phone-header-info { flex: 1; min-width: 0; }
.ks-phone-header-name {
  font-size: 13px; font-weight: 700; color: #0F172A; line-height: 1.2;
}
.ks-phone-header-status {
  font-size: 10px; color: #22c55e; font-weight: 600; line-height: 1.2; margin-top: 2px;
}
.ks-phone-call { font-size: 16px; opacity: .7; }

.ks-phone-messages {
  flex: 1;
  padding: 14px 14px 8px;
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 10px;
  background-image: radial-gradient(rgba(0,151,167,.08) 1px, transparent 1px);
  background-size: 20px 20px;
}

.ks-msg {
  display: flex; flex-direction: column; gap: 2px;
  max-width: 80%;
}
.ks-msg-in  { align-self: flex-start; }
.ks-msg-out { align-self: flex-end; align-items: flex-end; }

.ks-msg-anim {
  animation: ks-msg-in-anim .4s cubic-bezier(.2,.8,.2,1);
}
@keyframes ks-msg-in-anim {
  from { opacity: 0; transform: translateY(8px) scale(.95); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
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
  background: linear-gradient(135deg, #0097A7 0%, #0A2342 100%);
  color: #fff;
  border-top-right-radius: 4px;
}

.ks-msg-time { font-size: 9px; color: #94a3b8; padding: 0 6px; }
.ks-msg-out .ks-msg-time { color: rgba(15,23,42,.55); }

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

.ks-appt-card {
  background: linear-gradient(135deg, #fff 0%, #f8fafc 100%);
  border: 1px solid rgba(0,151,167,.25);
  border-radius: 14px;
  padding: 10px 12px;
  box-shadow: 0 4px 12px rgba(0,151,167,.18);
  min-width: 220px;
}
.ks-appt-card-header {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 700; color: #0097A7;
  text-transform: uppercase; letter-spacing: .04em;
  margin-bottom: 6px;
}
.ks-appt-card-line {
  font-size: 12px; color: #475569; margin: 2px 0;
}
.ks-appt-card-line-strong {
  font-size: 14px; color: #0F172A; font-weight: 700; margin: 4px 0;
}
.ks-appt-card-qr {
  display: flex; justify-content: center; margin-top: 6px;
  background: #fff; border-radius: 6px; padding: 4px;
}

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
  background: linear-gradient(135deg, #0097A7 0%, #0A2342 100%);
  color: #fff;
  font-size: 11px;
  box-shadow: 0 4px 12px rgba(0,151,167,.35);
}

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
}
`
