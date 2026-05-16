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
    const baseAudio = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 48000,
    }
    out.audio = mic ? { ...baseAudio, deviceId: { exact: mic } } : baseAudio
  } else {
    out.audio = false
  }
  if (video) {
    const cam = getPreferredCam()
    const baseVideo = {
      width:  { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 24 },
      facingMode: 'user',
    }
    out.video = cam ? { ...baseVideo, deviceId: { exact: cam } } : baseVideo
  } else {
    out.video = false
  }
  return out
}
