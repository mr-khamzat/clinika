import { useEffect, useRef, useState } from 'react'
// html5-qrcode (~250KB) — динамический импорт: грузим только при первом startScan.
// Если бы был статический import, всё равно попало бы в vendor-pdf-qr, но цепочка graph-а
// иногда зацепляет родителя через side-effects. Динамика гарантирует чистый чанк.
import { scanQR, confirmByCode } from '../api'
import { useNavigate } from 'react-router-dom'

export default function ScanScreen() {
  const [mode, setMode] = useState('qr') // 'qr' | 'code'
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [shortCode, setShortCode] = useState('')
  const [codeLoading, setCodeLoading] = useState(false)
  const scannerRef = useRef(null)
  const nav = useNavigate()

  const startScan = async () => {
    setScanning(true)
    setError(null)
    setResult(null)
    const { Html5Qrcode } = await import('html5-qrcode')
    const scanner = new Html5Qrcode('qr-reader')
    scannerRef.current = scanner
    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          await scanner.stop()
          setScanning(false)
          try {
            const res = await scanQR(decodedText)
            setResult(res.data)
          } catch (err) {
            setError(err.response?.data?.detail || 'Ошибка сканирования')
          }
        },
        () => {}
      )
    } catch {
      setScanning(false)
      setError('Не удалось открыть камеру')
    }
  }

  const stopScan = async () => {
    if (scannerRef.current?.isScanning) {
      await scannerRef.current.stop()
    }
    setScanning(false)
  }

  const handleCodeSubmit = async (e) => {
    e.preventDefault()
    const code = parseInt(shortCode.replace(/\D/g, ''), 10)
    if (!code || shortCode.replace(/\D/g, '').length !== 5) {
      setError('Введите 5-значный код')
      return
    }
    setCodeLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await confirmByCode(code)
      setResult(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Ошибка подтверждения')
    } finally {
      setCodeLoading(false)
    }
  }

  const handleReset = () => {
    setResult(null)
    setError(null)
    setShortCode('')
  }

  const switchMode = (m) => {
    stopScan()
    setMode(m)
    setError(null)
    setResult(null)
    setShortCode('')
  }

  useEffect(() => () => { stopScan() }, [])

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-xl flex items-center justify-between px-4 h-14 border-b border-slate-200/60 dark:border-slate-700/60">
        <span className="text-base font-semibold text-slate-800 dark:text-slate-100">
          Подтверждение визита
        </span>
      </header>

      {/* Content */}
      <div className="pt-20 pb-28 px-4 flex flex-col items-center">

        {/* Success State */}
        {result && (
          <div className="w-full max-w-sm flex flex-col items-center gap-5 mt-4">
            {/* Icon */}
            <div className="relative flex items-center justify-center w-28 h-28">
              <div className="absolute inset-0 bg-green-500/10 rounded-full blur-3xl animate-pulse" />
              <span className="material-symbols-outlined text-green-500 text-7xl relative z-10" style={{ fontVariationSettings: "'FILL' 1" }}>
                check_circle
              </span>
            </div>

            <h2 className="text-3xl font-extrabold text-slate-800 dark:text-slate-100">Подтверждено!</h2>

            {/* Patient & service card */}
            <div className="w-full bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-slate-700">
              <p className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">{result.service_name}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">Пациент: {result.patient_phone}</p>
            </div>

            {/* Bonus card */}
            {result.bonus_amount && (
              <div className="w-full bg-green-50 dark:bg-green-900/20 rounded-3xl p-5 flex items-center gap-4">
                <div className="bg-green-500 w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                    redeem
                  </span>
                </div>
                <div>
                  <p className="text-xl font-extrabold text-green-600 dark:text-green-400">
                    +{result.bonus_amount} руб
                  </p>
                  <p className="text-sm text-green-700/70 dark:text-green-400/70">Бонус начислен</p>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="w-full flex flex-col gap-3">
              <button
                onClick={() => nav(`/qr/${result.id}`)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-2xl py-3.5 text-sm font-semibold transition"
              >
                Открыть направление
              </button>
              <button
                onClick={handleReset}
                className="w-full border border-gray-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-2xl py-3.5 text-sm font-semibold transition hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Ещё одно
              </button>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !result && (
          <div className="w-full max-w-sm flex flex-col items-center gap-4 mt-4">
            <div className="relative flex items-center justify-center w-28 h-28">
              <div className="absolute inset-0 bg-red-500/10 rounded-full blur-3xl animate-pulse" />
              <span className="material-symbols-outlined text-red-500 text-7xl relative z-10" style={{ fontVariationSettings: "'FILL' 1" }}>
                cancel
              </span>
            </div>
            <p className="text-red-600 dark:text-red-400 font-semibold text-base text-center">{error}</p>
            <button
              onClick={handleReset}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-2xl py-3.5 text-sm font-semibold transition"
            >
              Попробовать снова
            </button>
          </div>
        )}

        {/* Normal flow (no result, no error) */}
        {!result && !error && (
          <div className="w-full max-w-sm flex flex-col gap-5">
            {/* Tabs */}
            <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl p-1.5 flex gap-1">
              <button
                onClick={() => switchMode('qr')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium transition ${
                  mode === 'qr'
                    ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <span className="material-symbols-outlined text-base leading-none">qr_code_scanner</span>
                Сканировать QR
              </button>
              <button
                onClick={() => switchMode('code')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium transition ${
                  mode === 'code'
                    ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <span className="material-symbols-outlined text-base leading-none">pin</span>
                Ввести код
              </button>
            </div>

            {/* QR Mode */}
            {mode === 'qr' && (
              <div className="flex flex-col items-center gap-4">
                {/* Scanner area */}
                <div className="w-full aspect-square rounded-3xl bg-slate-900 shadow-2xl overflow-hidden relative">
                  {/* Hidden html5-qrcode target */}
                  <div
                    id="qr-reader"
                    className={scanning ? 'absolute inset-0 w-full h-full' : 'hidden'}
                  />

                  {/* Viewfinder overlay */}
                  {!scanning && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      {/* SVG corner brackets */}
                      <svg
                        className="absolute inset-0 w-full h-full"
                        viewBox="0 0 300 300"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        {/* Top-left */}
                        <path d="M60 100 L60 60 L100 60" stroke="white" strokeWidth="4" strokeLinecap="round" />
                        {/* Top-right */}
                        <path d="M200 60 L240 60 L240 100" stroke="white" strokeWidth="4" strokeLinecap="round" />
                        {/* Bottom-left */}
                        <path d="M60 200 L60 240 L100 240" stroke="white" strokeWidth="4" strokeLinecap="round" />
                        {/* Bottom-right */}
                        <path d="M200 240 L240 240 L240 200" stroke="white" strokeWidth="4" strokeLinecap="round" />
                      </svg>

                      <span className="material-symbols-outlined text-white/30 text-8xl">
                        qr_code_scanner
                      </span>
                      <p className="text-white/50 text-sm mt-3 text-center px-8">
                        Наведите камеру на QR-код направления
                      </p>
                    </div>
                  )}

                  {/* Animated scan line when scanning */}
                  {scanning && (
                    <div className="absolute inset-0 pointer-events-none">
                      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 300 300" fill="none">
                        <path d="M60 100 L60 60 L100 60" stroke="white" strokeWidth="4" strokeLinecap="round" />
                        <path d="M200 60 L240 60 L240 100" stroke="white" strokeWidth="4" strokeLinecap="round" />
                        <path d="M60 200 L60 240 L100 240" stroke="white" strokeWidth="4" strokeLinecap="round" />
                        <path d="M200 240 L240 240 L240 200" stroke="white" strokeWidth="4" strokeLinecap="round" />
                      </svg>
                      <div
                        className="absolute left-[20%] right-[20%] h-0.5 bg-blue-400 shadow-[0_0_8px_2px_rgba(96,165,250,0.7)]"
                        style={{ animation: 'scanLine 2s linear infinite', top: '20%' }}
                      />
                    </div>
                  )}
                </div>

                {!scanning ? (
                  <button
                    onClick={startScan}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-2xl py-3.5 font-semibold text-sm transition"
                  >
                    Начать сканирование
                  </button>
                ) : (
                  <button
                    onClick={stopScan}
                    className="w-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-2xl py-3.5 font-semibold text-sm transition"
                  >
                    Отмена
                  </button>
                )}
              </div>
            )}

            {/* Code Mode */}
            {mode === 'code' && (
              <div className="flex flex-col items-center gap-5">
                <div className="text-center">
                  <h2 className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">
                    Введите 5-значный код
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Код указан в направлении пациента
                  </p>
                </div>

                <form onSubmit={handleCodeSubmit} className="w-full flex flex-col gap-4">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={5}
                    value={shortCode}
                    onChange={e => setShortCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    placeholder="_ _ _ _ _"
                    className="w-full text-center text-5xl font-extrabold tracking-[0.5em] border-b-2 border-blue-500 bg-transparent py-6 focus:outline-none text-blue-600 dark:text-blue-400 placeholder-slate-200 dark:placeholder-slate-700"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={shortCode.length !== 5 || codeLoading}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-2xl py-3.5 font-semibold text-sm transition disabled:opacity-40"
                  >
                    {codeLoading ? 'Проверяем...' : 'Подтвердить визит'}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scan line animation */}
      <style>{`
        @keyframes scanLine {
          0%   { top: 20%; }
          50%  { top: 75%; }
          100% { top: 20%; }
        }
      `}</style>
    </div>
  )
}
