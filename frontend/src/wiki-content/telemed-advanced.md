---
title: Telemed · Screen sharing, тест устройств, ICE-restart
slug: telemed-advanced
group: feature
updated: 2026-05-17
reading_time: 6
---

# Telemed · Screen sharing, тест устройств, ICE-restart

Три продвинутые возможности модуля телемедицины, которые делают приём врач↔пациент по WebRTC надёжнее и удобнее.

## Зачем это нужно

- **Screen sharing**: врач показывает пациенту анализы, схемы, презентацию — без переключения на отдельный сервис.
- **DeviceTestModal**: пациент перед звонком проверяет камеру, микрофон и динамики — снижает «не слышу/не вижу» на старте приёма.
- **Auto-ICE-restart**: при кратковременной потере связи (метро, лифт, переключение Wi-Fi → 4G) звонок восстанавливается автоматически.

## Screen sharing

### Как работает

`navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })` запрашивает у браузера разрешение на захват экрана. После получения нового `MediaStreamTrack` мы заменяем исходящий видеотрек через `RTCRtpSender.replaceTrack`:

```jsx
async function startScreenShare(pc) {
  const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const screenTrack = screen.getVideoTracks()[0];
  const sender = pc.getSenders().find(s => s.track?.kind === 'video');
  await sender.replaceTrack(screenTrack);

  screenTrack.onended = () => stopScreenShare(pc); // системная кнопка «Stop sharing»
  setIsSharing(true);
}

async function stopScreenShare(pc) {
  const cam = (await navigator.mediaDevices.getUserMedia({ video: true })).getVideoTracks()[0];
  const sender = pc.getSenders().find(s => s.track?.kind === 'video');
  await sender.replaceTrack(cam);
  setIsSharing(false);
}
```

Renegotiation **не нужна** — `replaceTrack` меняет media silently. Это критично: пациент не видит «чёрный кадр» при переключении.

### UI

В панели управления звонком кнопка «🖥️ Экран». Активный режим — обводка зелёная + значок «вы транслируете экран» поверх видео врача.

> 💡 На iOS Safari `getDisplayMedia` не поддерживается до 16+. UI скрывает кнопку, если фича недоступна.

## DeviceTestModal

Открывается перед входом в звонок (флаг `tested=false` в LocalStorage). Внутри:

### 1. Список устройств

```jsx
const devices = await navigator.mediaDevices.enumerateDevices();
const cams = devices.filter(d => d.kind === 'videoinput');
const mics = devices.filter(d => d.kind === 'audioinput');
const speakers = devices.filter(d => d.kind === 'audiooutput');
```

Пользователь выбирает дефолтные из dropdown. Выбор сохраняется в `localStorage.telemed_devices`.

### 2. VU-meter микрофона

`AudioContext + AnalyserNode` показывает уровень громкости в реальном времени:

```jsx
const ctx = new AudioContext();
const src = ctx.createMediaStreamSource(stream);
const analyser = ctx.createAnalyser();
src.connect(analyser);

const data = new Uint8Array(analyser.frequencyBinCount);
function loop() {
  analyser.getByteFrequencyData(data);
  const level = Math.max(...data) / 255; // 0..1
  setMicLevel(level);
  requestAnimationFrame(loop);
}
```

UI: горизонтальная полоса, зелёная при `level > 0.1`. Если за 5 секунд молчания пользователь не видит подсветки — модалка показывает «Микрофон не работает».

### 3. Тест динамика

Кнопка «Воспроизвести звук» — играет короткий beep через `HTMLAudioElement.setSinkId(speakerId)`.

## Auto-ICE-restart

### Зачем

WebRTC соединение завязано на ICE candidates. При смене сети (Wi-Fi → 4G) старые кандидаты невалидны, `pc.connectionState` уходит в `disconnected`. Без перезапуска ICE звонок умрёт через 30-60 секунд.

### Механизм

`pc.onconnectionstatechange` ловит переход в `disconnected` или `failed`:

```jsx
let attempts = 0;
const backoff = [1000, 3000, 6000];

pc.onconnectionstatechange = async () => {
  if (pc.connectionState === 'connected') {
    attempts = 0;
    return;
  }
  if (['disconnected', 'failed'].includes(pc.connectionState) && attempts < 3) {
    await new Promise(r => setTimeout(r, backoff[attempts]));
    attempts++;
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      // отправить SDP через сигналинг
      sendSignal({ type: 'offer', sdp: offer.sdp, iceRestart: true });
    } catch (e) {
      console.warn('ICE restart failed', e);
    }
  } else if (attempts >= 3) {
    showError('Не удалось восстановить соединение. Перезагрузите страницу.');
  }
};
```

Параметры:

- Backoff: **1 / 3 / 6 секунд** (нарастающие, чтобы не задолбить сеть).
- Максимум **3 попытки**, после — показ ошибки.
- Свежий ICE-конфиг (TURN-креды) берётся из `/presence/ice-config` каждый restart (HMAC-SHA1 timestamps живут 1 час).

### Логирование

Каждая попытка записывается в audit через `POST /api/telemed/calls/{id}/ice-restart`:

```json
{ "attempt": 2, "backoff_ms": 3000, "prev_state": "disconnected" }
```

Управляющий видит это в логе звонка — помогает диагностировать «у меня всё время рвётся».

## FAQ

**Можно ли расшаривать только окно, а не весь экран?** Да, `getDisplayMedia` показывает системный picker — окно/экран/вкладка.

**Звук системы передаётся при screen share?** Только если пациент явно отметит галку «Share audio» в picker (только Chromium).

**Что если оба раза ICE-restart провалился?** Сессия помечается `status=interrupted`, врач видит «Связь потеряна», может нажать «Перезвонить» — создаётся новая сессия с тем же `protocol_id`.
