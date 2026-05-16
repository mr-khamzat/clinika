# Calls Advanced Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать 3 фичи telemed-звонка в браузере (screen sharing, тест устройств перед звонком, auto-ICE-restart) согласно spec `docs/superpowers/specs/2026-05-16-calls-advanced-design.md` (commit 5e5a2ed).

**Architecture:** Frontend-only изменения в `CallWidget.jsx` + 1 новый компонент `DeviceTestModal.jsx`. WebRTC peer-to-peer через существующий TURN/STUN (`/presence/ice-config`), backend не трогаем. Все фичи независимы и могут включаться отдельно.

**Tech Stack:** React 18, WebRTC (`RTCPeerConnection`, `getUserMedia`, `getDisplayMedia`), AudioContext API, browser MediaDevices API.

---

## File Structure

| Файл | Ответственность |
|------|----------------|
| `frontend/src/components/CallWidget.jsx` | +Screen sharing handlers, +ICE-restart listener, +reconnecting overlay |
| `frontend/src/components/calls/DeviceTestModal.jsx` (новый) | Модал теста микро/камеры с live-preview и VU-meter |
| `frontend/src/components/IncomingCallModal.jsx` | +кнопка «Проверить устройства» |
| `frontend/src/lib/deviceStorage.js` (новый, малый) | Хелперы localStorage для deviceId mic/cam |

---

## Task 1: localStorage хелперы для deviceId

**Files:**
- Create: `frontend/src/lib/deviceStorage.js`

- [ ] **Step 1: Создать хелпер**

```js
/**
 * Сохранение/чтение предпочитаемых mediaDevice ID в localStorage.
 * Использование:
 *   import { getPreferredMic, setPreferredMic, ... } from './deviceStorage'
 */
const KEY_MIC = 'clinika_mic_device_id'
const KEY_CAM = 'clinika_cam_device_id'

export function getPreferredMic() {
  try { return localStorage.getItem(KEY_MIC) || '' } catch { return '' }
}
export function setPreferredMic(id) {
  try { id ? localStorage.setItem(KEY_MIC, id) : localStorage.removeItem(KEY_MIC) } catch {}
}
export function getPreferredCam() {
  try { return localStorage.getItem(KEY_CAM) || '' } catch { return '' }
}
export function setPreferredCam(id) {
  try { id ? localStorage.setItem(KEY_CAM, id) : localStorage.removeItem(KEY_CAM) } catch {}
}

/**
 * Возвращает constraints для getUserMedia с предпочтительным deviceId если есть.
 * Использование: getUserMedia(buildMediaConstraints({ audio: true, video: true }))
 */
export function buildMediaConstraints({ audio = true, video = true } = {}) {
  const out = {}
  if (audio) {
    const mic = getPreferredMic()
    out.audio = mic ? { deviceId: { exact: mic }, noiseSuppression: true, echoCancellation: true } : { noiseSuppression: true, echoCancellation: true }
  } else {
    out.audio = false
  }
  if (video) {
    const cam = getPreferredCam()
    out.video = cam ? { deviceId: { exact: cam } } : true
  } else {
    out.video = false
  }
  return out
}
```

- [ ] **Step 2: Загрузить файл**

```bash
sshpass -p 'Kh@mzat88712' scp /tmp/.../deviceStorage.js root@212.57.118.126:/opt/clinika/frontend/src/lib/
```

- [ ] **Step 3: Commit**

```bash
cd /opt/clinika && git add frontend/src/lib/deviceStorage.js
git -c commit.gpgsign=false commit -m "feat(calls): localStorage helpers для deviceId mic/cam"
```

---

## Task 2: DeviceTestModal — тест устройств с live-preview

**Files:**
- Create: `frontend/src/components/calls/DeviceTestModal.jsx`

- [ ] **Step 1: Создать компонент**

```jsx
/**
 * DeviceTestModal — тест микрофона/камеры перед звонком.
 *
 * Props:
 *   open: bool
 *   onClose: () => void
 *   onConfirm: ({mic, cam}) => void — пользователь нажал «Начать звонок»
 *   title?: string — заголовок (по умолчанию «Проверьте устройства»)
 *   confirmLabel?: string — текст кнопки confirm (по умолч. «Начать звонок»)
 */
import { useEffect, useRef, useState } from 'react'
import {
  getPreferredMic, setPreferredMic,
  getPreferredCam, setPreferredCam,
} from '../../lib/deviceStorage'

export default function DeviceTestModal({
  open, onClose, onConfirm,
  title = 'Проверьте устройства',
  confirmLabel = 'Начать звонок',
}) {
  const [mics, setMics] = useState([])
  const [cams, setCams] = useState([])
  const [selectedMic, setSelectedMic] = useState(getPreferredMic())
  const [selectedCam, setSelectedCam] = useState(getPreferredCam())
  const [error, setError] = useState('')
  const [level, setLevel] = useState(0)   // 0..100, VU-meter
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const rafRef = useRef(0)

  // Enumerate devices при open
  useEffect(() => {
    if (!open) return
    setError('')
    navigator.mediaDevices.enumerateDevices().then(list => {
      setMics(list.filter(d => d.kind === 'audioinput'))
      setCams(list.filter(d => d.kind === 'videoinput'))
    }).catch(e => setError('Не удалось получить список устройств: ' + (e?.message || e)))
  }, [open])

  // Старт live-preview при смене устройств
  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function start() {
      // Останавливаем предыдущий stream
      cleanup()
      try {
        const constraints = {
          audio: selectedMic ? { deviceId: { exact: selectedMic } } : true,
          video: selectedCam ? { deviceId: { exact: selectedCam } } : true,
        }
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        // VU-meter setup
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
        audioCtxRef.current = audioCtx
        const source = audioCtx.createMediaStreamSource(stream)
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        const data = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          analyser.getByteFrequencyData(data)
          let sum = 0
          for (let i = 0; i < data.length; i++) sum += data[i]
          const avg = sum / data.length
          setLevel(Math.min(100, Math.round((avg / 128) * 100)))
          rafRef.current = requestAnimationFrame(tick)
        }
        tick()
        setError('')
      } catch (e) {
        setError('Не удалось открыть устройство: ' + (e?.message || e))
      }
    }
    start()
    return () => { cancelled = true; cleanup() }
  }, [open, selectedMic, selectedCam])

  function cleanup() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close() } catch {}
      audioCtxRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  const confirm = () => {
    setPreferredMic(selectedMic)
    setPreferredCam(selectedCam)
    cleanup()
    onConfirm?.({ mic: selectedMic, cam: selectedCam })
  }

  const close = () => { cleanup(); onClose?.() }

  if (!open) return null

  const inputStyle = {
    width: '100%', padding: '8px 12px', borderRadius: 10,
    background: 'var(--bg-1, #f6f6f8)',
    border: '1px solid var(--border, rgba(0,0,0,.08))',
    color: 'var(--fg, #0F172A)', fontSize: 14,
  }

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(4px)' }}
      onClick={close}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg rounded-3xl overflow-hidden p-5 space-y-3"
        style={{ background: 'var(--bg, #fff)', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}
      >
        <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>

        {/* Live preview */}
        <div
          style={{
            position: 'relative',
            background: '#000', borderRadius: 14, overflow: 'hidden',
            aspectRatio: '16/9',
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          {/* VU-meter overlay */}
          <div
            style={{
              position: 'absolute', bottom: 8, left: 8, right: 8, height: 8,
              borderRadius: 4, background: 'rgba(255,255,255,.18)', overflow: 'hidden',
            }}
            title="Уровень микрофона"
          >
            <div
              style={{
                width: `${level}%`, height: '100%',
                background: level > 70 ? '#ef4444' : level > 40 ? '#22c55e' : '#94a3b8',
                transition: 'width 60ms linear',
              }}
            />
          </div>
        </div>

        {/* Device selectors */}
        <label>
          <div style={{ fontSize: 12, color: 'var(--fg-2, #475569)', marginBottom: 4 }}>
            Микрофон
          </div>
          <select
            value={selectedMic}
            onChange={e => setSelectedMic(e.target.value)}
            style={inputStyle}
          >
            <option value="">Системный по умолчанию</option>
            {mics.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Микрофон ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div style={{ fontSize: 12, color: 'var(--fg-2, #475569)', marginBottom: 4 }}>
            Камера
          </div>
          <select
            value={selectedCam}
            onChange={e => setSelectedCam(e.target.value)}
            style={inputStyle}
          >
            <option value="">Системная по умолчанию</option>
            {cams.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Камера ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <div
            className="rounded-xl p-3"
            style={{ background: '#fee2e2', color: '#991b1b', fontSize: 13 }}
          >
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={close}
            className="flex-1 py-2.5 rounded-xl font-semibold"
            style={{ background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}
          >
            Отмена
          </button>
          <button
            onClick={confirm}
            disabled={!!error}
            className="flex-1 py-2.5 rounded-xl font-semibold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Загрузить**

```bash
mkdir -p /tmp/clinika_edit/calls
sshpass scp .../DeviceTestModal.jsx root@...:/opt/clinika/frontend/src/components/calls/DeviceTestModal.jsx
```
(Каталог `calls/` нужно создать — проверь и `mkdir -p` если нет.)

- [ ] **Step 3: Syntax check**

```bash
ssh root@... 'cd /opt/clinika/frontend && node -e "require(\"@babel/parser\").parse(require(\"fs\").readFileSync(\"src/components/calls/DeviceTestModal.jsx\",\"utf-8\"),{sourceType:\"module\",plugins:[\"jsx\"]}); console.log(\"OK\")"'
```
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/calls/DeviceTestModal.jsx
git -c commit.gpgsign=false commit -m "feat(calls): DeviceTestModal — live preview + VU-meter + выбор устройств"
```

---

## Task 3: Screen sharing в CallWidget

**Files:**
- Modify: `frontend/src/components/CallWidget.jsx`

- [ ] **Step 1: SCP и инспекция текущего state'а CallWidget**

```bash
sshpass -p 'Kh@mzat88712' scp root@212.57.118.126:/opt/clinika/frontend/src/components/CallWidget.jsx /tmp/clinika_edit/CallWidget.jsx
grep -nE "RTCPeerConnection|getUserMedia|hangup|action-bar|setMuted|isMuted" /tmp/clinika_edit/CallWidget.jsx | head -20
```

Цель: найти место с action-bar (кнопки mute/hangup) и `pc` (RTCPeerConnection).

- [ ] **Step 2: Добавить state и хелперы для screen sharing**

В компонент `CallWidget` добавь (после существующих useState):
```jsx
const [isSharing, setIsSharing] = useState(false)
const cameraTrackRef = useRef(null)
const screenTrackRef = useRef(null)

const startScreenShare = async () => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' },
      audio: false,
    })
    const screenTrack = stream.getVideoTracks()[0]
    screenTrackRef.current = screenTrack
    // Замена video sender'а на screen
    const pc = pcRef.current  // pc уже хранится в pcRef; если нет — взять из state
    const videoSender = pc?.getSenders?.().find(s => s.track && s.track.kind === 'video')
    if (videoSender) {
      cameraTrackRef.current = videoSender.track
      await videoSender.replaceTrack(screenTrack)
    }
    screenTrack.onended = () => stopScreenShare()
    setIsSharing(true)
  } catch (e) {
    // Пользователь нажал Cancel в picker'е — это норма, не ошибка
    if (e?.name === 'NotAllowedError') return
    console.warn('startScreenShare failed', e)
  }
}

const stopScreenShare = async () => {
  const pc = pcRef.current
  const videoSender = pc?.getSenders?.().find(s => s.track && s.track.kind === 'video')
  if (videoSender && cameraTrackRef.current) {
    await videoSender.replaceTrack(cameraTrackRef.current)
  }
  if (screenTrackRef.current) {
    try { screenTrackRef.current.stop() } catch {}
    screenTrackRef.current = null
  }
  setIsSharing(false)
}

const toggleScreenShare = () => isSharing ? stopScreenShare() : startScreenShare()
```

⚠️ **Адаптация:** Если в `CallWidget` нет `pcRef`, а `pc` хранится в state — замени `pcRef.current` на актуальную ссылку. Найди по строке `const pc = new RTCPeerConnection`.

- [ ] **Step 3: Добавить кнопку в action-bar**

Найди блок с кнопкой mute и hangup. Между ними вставь:
```jsx
<button
  onClick={toggleScreenShare}
  className="call-action-btn"
  title={isSharing ? 'Остановить демонстрацию' : 'Показать экран'}
  style={{
    background: isSharing ? '#0EA5E9' : 'rgba(255,255,255,.15)',
    color: '#fff',
    border: isSharing ? '2px solid #0284C7' : '2px solid transparent',
    borderRadius: 999,
    width: 56, height: 56,
    display: 'grid', placeItems: 'center',
    cursor: 'pointer',
  }}
>
  <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
    {isSharing ? 'stop_screen_share' : 'screen_share'}
  </span>
</button>
```

(Если в CallWidget нет material-symbols-outlined — используй встроенные иконки или SVG аналог `screen_share`.)

- [ ] **Step 4: Cleanup при hangup**

Найди функцию `hangup` (или close-call). В её начале добавь:
```jsx
// Если идёт screen share — остановить track перед закрытием pc
if (screenTrackRef.current) {
  try { screenTrackRef.current.stop() } catch {}
  screenTrackRef.current = null
}
```

- [ ] **Step 5: Загрузить + syntax check**

```bash
scp /tmp/clinika_edit/CallWidget.jsx root@...:/opt/clinika/frontend/src/components/CallWidget.jsx
ssh root@... 'cd /opt/clinika/frontend && node -e "require(\"@babel/parser\").parse(...)"'
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/CallWidget.jsx
git -c commit.gpgsign=false commit -m "feat(calls): screen sharing в telemed-звонке (getDisplayMedia + replaceTrack)"
```

---

## Task 4: Auto-ICE-restart

**Files:**
- Modify: `frontend/src/components/CallWidget.jsx`

- [ ] **Step 1: State и ref**

В `CallWidget` рядом с `isSharing`:
```jsx
const [reconnecting, setReconnecting] = useState(false)
const reconnectAttemptsRef = useRef(0)
```

- [ ] **Step 2: Listener на iceconnectionstatechange**

Найди где создаётся pc (`const pc = new RTCPeerConnection(...)`). СРАЗУ после создания вставь:
```jsx
pc.addEventListener('iceconnectionstatechange', async () => {
  const s = pc.iceConnectionState
  // Connected — сброс счётчика
  if (s === 'connected' || s === 'completed') {
    setReconnecting(false)
    reconnectAttemptsRef.current = 0
    return
  }
  // Не нужно реагировать на остальные состояния кроме disconnected/failed
  if (s !== 'disconnected' && s !== 'failed') return
  // Лимит 3 попытки
  if (reconnectAttemptsRef.current >= 3) {
    setReconnecting(false)
    toast?.('Не удалось восстановить связь', 'error')
    try { hangup?.() } catch {}
    return
  }
  setReconnecting(true)
  const attempt = ++reconnectAttemptsRef.current
  const delay = attempt === 1 ? 1000 : attempt === 2 ? 3000 : 6000
  await new Promise(r => setTimeout(r, delay))
  try {
    if (typeof pc.restartIce === 'function') {
      pc.restartIce()
    }
    const offer = await pc.createOffer({ iceRestart: true })
    await pc.setLocalDescription(offer)
    // Отправляем offer через существующий signaling.
    // Найди как сейчас передаётся offer (вероятно через WS) и используй тот же канал.
    sendSignal?.({ type: 'offer', sdp: offer.sdp, ice_restart: true })
  } catch (e) {
    console.warn('ICE restart attempt failed', e)
  }
})
```

⚠️ **`sendSignal`** — название может отличаться. Найди в текущем коде `ws.send` или подобный паттерн где отправляется первоначальный offer. Используй тот же механизм. Если нужен новый event-type — добавь его в обработчик WS на стороне фронта (приём `answer` с `ice_restart` уже работает по обычному offer/answer пути).

- [ ] **Step 3: Overlay UI**

Найди блок где рендерится `<video>` со remote stream'ом. Оберни его в относительный div или добавь рядом:
```jsx
{reconnecting && (
  <div
    style={{
      position: 'absolute', inset: 0, zIndex: 10,
      background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(2px)',
      display: 'grid', placeItems: 'center',
      color: '#fff', fontSize: 16, fontWeight: 600,
      textAlign: 'center', padding: 20,
    }}
  >
    <div>
      <div style={{ fontSize: 32, marginBottom: 8 }}>🔄</div>
      Переподключение…<br/>
      <span style={{ fontSize: 13, opacity: .8 }}>
        попытка {reconnectAttemptsRef.current} из 3
      </span>
    </div>
  </div>
)}
```

- [ ] **Step 4: Syntax check + commit**

```bash
node -e "require(\"@babel/parser\").parse(...)"
git add frontend/src/components/CallWidget.jsx
git -c commit.gpgsign=false commit -m "feat(calls): auto-ICE-restart при потере связи (max 3 попытки, backoff 1/3/6s)"
```

---

## Task 5: Интеграция DeviceTestModal в IncomingCallModal

**Files:**
- Modify: `frontend/src/components/IncomingCallModal.jsx`

- [ ] **Step 1: SCP и инспекция**

```bash
sshpass scp root@...:/opt/clinika/frontend/src/components/IncomingCallModal.jsx /tmp/clinika_edit/
grep -nE "onAccept|accept|onPick|Принять" /tmp/clinika_edit/IncomingCallModal.jsx | head -10
```

- [ ] **Step 2: Добавить state и DeviceTestModal**

В верх:
```jsx
import { useState } from 'react'
import DeviceTestModal from './calls/DeviceTestModal'
```

Внутри компонента:
```jsx
const [testOpen, setTestOpen] = useState(false)
```

Рядом с кнопкой «Принять» добавь:
```jsx
<button
  onClick={() => setTestOpen(true)}
  className="..."  // тот же стиль что у Reject но в нейтральном цвете
  style={{
    background: 'var(--bg-1, #f1f5f9)',
    color: 'var(--fg-2, #475569)',
    padding: '10px 16px', borderRadius: 14, fontWeight: 600,
  }}
>
  ⚙ Проверить устройства
</button>
```

После закрытия модалки или в самом конце JSX:
```jsx
<DeviceTestModal
  open={testOpen}
  onClose={() => setTestOpen(false)}
  onConfirm={() => {
    setTestOpen(false)
    onAccept?.()  // или как называется обработчик «Принять»
  }}
  title="Проверьте устройства перед звонком"
  confirmLabel="Принять звонок"
/>
```

⚠️ **Имя обработчика** «Принять» может быть `onAccept`, `accept`, `onAnswer`, `onPick` — найди в коде и используй то же имя.

- [ ] **Step 3: Syntax + commit**

```bash
node -e "..."
git add frontend/src/components/IncomingCallModal.jsx
git -c commit.gpgsign=false commit -m "feat(calls): DeviceTestModal интеграция в IncomingCallModal"
```

---

## Task 6: Использовать deviceStorage в CallWidget при getUserMedia

**Files:**
- Modify: `frontend/src/components/CallWidget.jsx`

- [ ] **Step 1: Импорт и замена**

В импорты:
```jsx
import { buildMediaConstraints } from '../lib/deviceStorage'
```

Найди строку:
```jsx
const stream = await navigator.mediaDevices.getUserMedia({
  audio: true,
  video: true,
  noiseSuppression: true,  // или похожее
})
```

Замени на:
```jsx
const stream = await navigator.mediaDevices.getUserMedia(
  buildMediaConstraints({ audio: true, video: true })
)
```

`buildMediaConstraints` сама подхватит сохранённые в localStorage deviceId.

- [ ] **Step 2: Syntax + commit**

```bash
node -e "..."
git add frontend/src/components/CallWidget.jsx
git -c commit.gpgsign=false commit -m "feat(calls): CallWidget использует buildMediaConstraints (предпочитаемые устройства)"
```

---

## Task 7: Build + final smoke

- [ ] **Step 1: Rebuild frontend**

```bash
sshpass -p 'Kh@mzat88712' ssh root@212.57.118.126 'cd /opt/clinika && docker compose build --no-cache clinika-frontend 2>&1 | tail -5 && docker compose up -d clinika-frontend 2>&1 | tail -3 && sleep 6 && docker compose ps clinika-frontend && curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8901/'
```
Expected: `HTTP 200`, контейнер `healthy`.

- [ ] **Step 2: Manual smoke в браузере**

Эти проверки нельзя автоматизировать (нужен браузер):

1. Открыть страницу пациента / врача, инициировать telemed-звонок
2. **Screen sharing:**
   - В action-bar появилась кнопка screen_share
   - Клик → системный picker (выбор экрана/окна/вкладки)
   - После выбора собеседник видит экран вместо камеры
   - Повторный клик ИЛИ системная кнопка «Stop sharing» → видео автоматически вернулось
3. **Device test:**
   - Перед принятием входящего — кнопка «⚙ Проверить устройства»
   - Открывается модал с live-preview камеры
   - VU-meter реагирует на голос (зелёный → красный при крике)
   - Выбор другого микрофона/камеры — preview обновляется
   - Кнопка «Принять звонок» — сохраняет deviceId, начинает звонок
4. **ICE restart:**
   - Во время звонка: DevTools → Network → Offline (5 секунд)
   - Появляется overlay «🔄 Переподключение… попытка 1 из 3»
   - DevTools → Online — связь восстанавливается, overlay исчезает
   - Длинный обрыв (>15 с): 3 попытки → toast «Не удалось восстановить связь» + hangup

- [ ] **Step 3: TG-отчёт текстом**

Использовать существующий паттерн (см. предыдущие батчи) — несколько сообщений по 4 KB через @stclinik_addmin_bot.

---

## Self-Review

**1. Spec coverage:**
- §3.1 Screen sharing → Task 3
- §3.2 Test устройств → Task 1 (deviceStorage) + Task 2 (DeviceTestModal) + Task 5 (интеграция в IncomingCallModal) + Task 6 (использование в CallWidget)
- §3.3 Auto-ICE-restart → Task 4
- §5 Manual smoke — Task 7 Step 2 (6 проверок)

**2. Placeholder scan:**
Все шаги содержат код / точные команды. Две оговорки в Task 3 («адаптация pcRef») и Task 4 («sendSignal — название может отличаться») — это адаптивные шаги, требующие чтения существующего кода. Не плейсхолдеры — даю агенту инструкцию как искать, что искать и чем заменить.

**3. Type consistency:**
- `cameraTrackRef`, `screenTrackRef`, `reconnectAttemptsRef` — useRef'ы, имена одинаковы в Tasks 3/4
- `isSharing`, `reconnecting` — useState, одинаково
- `pcRef.current` — может потребовать адаптации (см. оговорку в Task 3)
- `buildMediaConstraints({audio, video})` — Task 1 определяет, Task 6 использует
- `getPreferredMic/setPreferredMic` — Task 1, используется внутри DeviceTestModal (Task 2)

OK, плана достаточно.
