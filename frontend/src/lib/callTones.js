/**
 * Звуковые сигналы звонка через Web Audio API.
 * - ringback (гудок) — для звонящего: 425 Гц, 1 с вкл / 4 с выкл (RU стандарт)
 * - ringtone (мелодия) — для принимающего: триаду нот A4/E5/A5 с эхо, повтор каждые 3 с
 */

let _audioCtx = null
function ctx() {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    const AC = window.AudioContext || window.webkitAudioContext
    _audioCtx = AC ? new AC() : null
  }
  if (_audioCtx && _audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {})
  return _audioCtx
}

// ── Ringback (гудок исходящего) ─────────────────────────────────────────────
let _rb = null

export function startRingback() {
  stopRingback()
  const ac = ctx()
  if (!ac) return
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = 'sine'
  osc.frequency.value = 425
  gain.gain.value = 0
  osc.connect(gain).connect(ac.destination)
  osc.start()

  // Цикл: 1 с играет, 4 с тишина (RU PSTN ringback)
  const PERIOD = 5
  const ON = 1
  const t0 = ac.currentTime
  let i = 0
  const schedule = () => {
    const t = t0 + i * PERIOD
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.18, t + 0.05)
    gain.gain.setValueAtTime(0.18, t + ON - 0.05)
    gain.gain.linearRampToValueAtTime(0, t + ON)
    i++
  }
  for (let j = 0; j < 6; j++) schedule()  // 30 сек вперёд
  const intv = setInterval(() => schedule(), PERIOD * 1000)
  _rb = { osc, gain, intv }
}

export function stopRingback() {
  if (!_rb) return
  try {
    clearInterval(_rb.intv)
    _rb.gain.gain.cancelScheduledValues(0)
    _rb.gain.gain.value = 0
    _rb.osc.stop()
    _rb.osc.disconnect()
    _rb.gain.disconnect()
  } catch {}
  _rb = null
}

// ── Ringtone (входящий) ─────────────────────────────────────────────────────
let _rt = null

export function startRingtone() {
  stopRingtone()
  const ac = ctx()
  if (!ac) return
  const master = ac.createGain()
  master.gain.value = 0.22
  master.connect(ac.destination)

  const NOTES = [
    { f: 880,  d: 0.18 },  // A5
    { f: 1175, d: 0.18 },  // D6
    { f: 1480, d: 0.18 },  // F#6
    { f: 1175, d: 0.18 },
    { f: 880,  d: 0.36 },
  ]
  const PERIOD = 3.0  // сек между повторами
  const t0 = ac.currentTime
  let i = 0

  const playOnce = (start) => {
    let t = start
    for (const n of NOTES) {
      const osc = ac.createOscillator()
      const g = ac.createGain()
      osc.type = 'triangle'
      osc.frequency.value = n.f
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(1, t + 0.01)
      g.gain.setValueAtTime(1, t + n.d - 0.04)
      g.gain.linearRampToValueAtTime(0, t + n.d)
      osc.connect(g).connect(master)
      osc.start(t)
      osc.stop(t + n.d + 0.02)
      t += n.d
    }
  }

  for (let j = 0; j < 5; j++) playOnce(t0 + j * PERIOD)
  const intv = setInterval(() => {
    if (!_rt) return
    const now = ctx().currentTime
    playOnce(now)
  }, PERIOD * 1000)
  _rt = { master, intv }
}

export function stopRingtone() {
  if (!_rt) return
  try {
    clearInterval(_rt.intv)
    _rt.master.gain.cancelScheduledValues(0)
    _rt.master.gain.value = 0
    _rt.master.disconnect()
  } catch {}
  _rt = null
}

// Пауза всех тонов (на случай неожиданного завершения звонка)
export function stopAllTones() {
  stopRingback()
  stopRingtone()
}
