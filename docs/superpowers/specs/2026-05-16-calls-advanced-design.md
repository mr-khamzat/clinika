# Calls advanced — Screen + Test + ICE Design

**Дата:** 2026-05-16
**Сессия:** brainstorming-4
**Зависимости:** WebRTC уже работает в `frontend/src/components/CallWidget.jsx`

---

## 1. Контекст

Telemed-звонок врач↔пациент в браузере уже работает:
- `CallWidget.jsx` 640 строк
- `RTCPeerConnection` + `getUserMedia({audio: true, video: true, noiseSuppression: true})`
- ICE config через `GET /presence/ice-config` (HMAC-SHA1 REST, coturn 3478)
- Запись + транскрипция уже реализованы (модуль `call_recording`, `CallRecordingsSection.jsx`)

Что отсутствует:
- Screen sharing — врач не может показать пациенту КТ-снимок или результат анализов
- Test устройств перед звонком — пациент часто заходит и узнаёт «мой микрофон не работает» уже в эфире
- Auto-ICE-restart — при кратком обрыве связи звонок просто умирает, нужно перезаходить

## 2. Цели и не-цели

**Цели:**
- Screen sharing в обе стороны (врач показывает пациенту, и наоборот)
- Test микр/камеры с live-preview перед началом
- Авто-восстановление WebRTC при кратком обрыве (3 попытки)

**Не-цели (отдельные сессии):**
- ❌ Multi-party — нужна mesh-архитектура или SFU
- ❌ Virtual bg / blur — нужен MediaPipe
- ❌ Voice messages в чате — другой контекст
- ❌ Те же фичи в Electron Calls (staff↔staff) — отдельная сессия

## 3. Архитектура

### 3.1 Screen sharing

**Новые состояния в `CallWidget`:**
- `isSharing: bool` — сейчас идёт screen share
- `cameraTrackRef: useRef` — сохранённый камера-track для возврата после screen share

**Логика:**
```js
async function startScreenShare() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { cursor: 'always' },
    audio: false,
  })
  const screenTrack = stream.getVideoTracks()[0]
  // Заменяем video sender'у на screen
  const videoSender = pc.getSenders().find(s => s.track?.kind === 'video')
  if (videoSender) {
    cameraTrackRef.current = videoSender.track  // запоминаем для возврата
    await videoSender.replaceTrack(screenTrack)
  }
  // Когда пользователь нажал "Stop sharing" в системном UI
  screenTrack.onended = () => stopScreenShare()
  setIsSharing(true)
}

async function stopScreenShare() {
  const videoSender = pc.getSenders().find(s => s.track?.kind === 'video')
  if (videoSender && cameraTrackRef.current) {
    await videoSender.replaceTrack(cameraTrackRef.current)
  }
  setIsSharing(false)
}
```

**UI:** новая кнопка `screen_share` в action-bar звонка (между mute и hangup).
Активная (синяя обводка) когда `isSharing=true`.

### 3.2 Test устройств (DeviceTestModal)

**Новый компонент `frontend/src/components/calls/DeviceTestModal.jsx`** — open/close через props.

Что внутри:
1. `mediaDevices.enumerateDevices()` → 2 dropdown:
   - Микрофон (`audioinput`)
   - Камера (`videoinput`)
2. Live-preview камеры в `<video autoPlay muted>` (локально, не отправляется)
3. VU-meter аудио: AudioContext → MediaStreamAudioSourceNode → AnalyserNode →
   getByteFrequencyData → анимированная полоса
4. Кнопки «Тест ОК — начать звонок» и «Отмена»

При выборе устройств — сохраняем в `localStorage`:
- `clinika_mic_device_id`
- `clinika_cam_device_id`

При следующем `getUserMedia` — используем эти `deviceId` если они доступны в `enumerateDevices()`.

**Точки интеграции:**
- В `IncomingCallModal` — кнопка «Проверить устройства» перед «Принять»
- В исходящем (если запускается через `CallWidget` — открывать DeviceTestModal перед `createOffer`)
- В активном звонке — кнопка ⚙ в action-bar для смены устройства на лету (через `getUserMedia` нового track + `replaceTrack`)

### 3.3 Auto-ICE-restart

**В `CallWidget.jsx`:**

```js
const reconnectAttemptsRef = useRef(0)
const [reconnecting, setReconnecting] = useState(false)

pc.addEventListener('iceconnectionstatechange', async () => {
  const s = pc.iceConnectionState
  if (s === 'connected' || s === 'completed') {
    setReconnecting(false)
    reconnectAttemptsRef.current = 0
    return
  }
  if (s !== 'disconnected' && s !== 'failed') return
  if (reconnectAttemptsRef.current >= 3) {
    toast?.('Не удалось восстановить связь', 'error')
    hangup()
    return
  }
  setReconnecting(true)
  const attempt = ++reconnectAttemptsRef.current
  const delay = attempt === 1 ? 1000 : attempt === 2 ? 3000 : 6000
  await new Promise(r => setTimeout(r, delay))
  try {
    if (typeof pc.restartIce === 'function') {
      pc.restartIce()  // W3C spec — preferred
    }
    const offer = await pc.createOffer({ iceRestart: true })
    await pc.setLocalDescription(offer)
    // Отправляем через существующий сигнальный канал (WS)
    sendSignal({ type: 'offer-restart', sdp: offer.sdp })
  } catch (e) {
    console.warn('ICE restart attempt failed', e)
  }
})
```

**UI:** оверлей поверх видео когда `reconnecting=true`:
```jsx
{reconnecting && (
  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)',
                display: 'grid', placeItems: 'center', color: '#fff', fontSize: 16 }}>
    🔄 Переподключение… (попытка {reconnectAttemptsRef.current}/3)
  </div>
)}
```

**Сигнальный канал на стороне сервера:** на бэке принимаем `offer-restart` — поведение идентично обычному `offer` (handshake переустановит candidates). Если бэк не поддерживает специфичный тип `offer-restart` — посылаем как обычный `offer`, получатель должен переответить answer'ом.

## 4. Безопасность

- Screen sharing требует user gesture — браузер сам показывает picker (нельзя обмануть)
- Видео preview в DeviceTestModal — локальный stream, не передаётся
- localStorage с deviceId — не sensitive (это enumerable ID, не персональные данные)
- ICE restart использует тот же ICE config (наш coturn + HMAC) — TLS уже на месте

## 5. Тестирование

**Юнит-тестов нет** — это всё browser-API, не тестируется в Node/pytest.

**Smoke в браузере (manual, после деплоя):**
1. Открыть телемед-звонок → нажать screen_share → выбрать экран → собеседник видит экран
2. Остановить (повторный клик или системный «Stop sharing») → видео автоматически вернулось
3. До звонка — открыть DeviceTestModal: live preview камеры, vu-meter реагирует на голос
4. Выбрать другой микрофон в dropdown → preview обновился
5. Симуляция обрыва: DevTools → Network throttling: Offline на 5 секунд → видеть «🔄 Переподключение… 1/3» → онлайн → связь восстанавливается без перезахода
6. Долгий обрыв (>15 сек): после 3 попыток — toast «Не удалось восстановить» + hangup

## 6. Open questions

Нет — все детали зафиксированы. Реализация — один frontend агент на CallWidget.jsx и новые компоненты.
