/**
 * ImageCropEditor — встроенный редактор кропа без внешних зависимостей.
 * Canvas + мышь/тач. Поддерживает: кроп, зум, поворот, пресеты соотношений, удаление фона.
 */
import { useEffect, useRef, useState, useCallback } from 'react'

const RATIOS = [
  { label: 'Свободно', value: null },
  { label: '16 : 4',   value: 4 },
  { label: '3 : 1',    value: 3 },
  { label: '16 : 9',   value: 16 / 9 },
  { label: '4 : 3',    value: 4 / 3 },
  { label: '1 : 1',    value: 1 },
]

function floodFillRemoveBg(imageData, tolerance) {
  const { data, width: w, height: h } = imageData
  const visited = new Uint8Array(w * h)
  const stack = []

  const corners = [[0,0],[w-1,0],[0,h-1],[w-1,h-1]]
  const bgSamples = corners.map(([x,y]) => {
    const i = (y * w + x) * 4
    return [data[i], data[i+1], data[i+2]]
  })

  const matches = (px) => {
    const r = data[px], g = data[px+1], b = data[px+2]
    return bgSamples.some(([br,bg,bb]) =>
      Math.abs(r-br) + Math.abs(g-bg) + Math.abs(b-bb) < tolerance * 3
    )
  }

  corners.forEach(([x,y]) => {
    const idx = y * w + x
    if (!visited[idx]) { visited[idx] = 1; stack.push(idx) }
  })

  while (stack.length > 0) {
    const idx = stack.pop()
    const px = idx * 4
    if (!matches(px)) continue
    data[px + 3] = 0
    const x = idx % w, y = Math.floor(idx / w)
    const neighbors = [x > 0 && idx-1, x < w-1 && idx+1, y > 0 && idx-w, y < h-1 && idx+w]
    neighbors.forEach(ni => {
      if (ni !== false && !visited[ni]) { visited[ni] = 1; stack.push(ni) }
    })
  }
  return imageData
}

export default function ImageCropEditor({ src, mime = 'image/jpeg', onDone, onCancel }) {
  const canvasRef = useRef(null)
  const imgRef    = useRef(null)

  const [crop, setCrop]     = useState({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
  const [ratio, setRatio]   = useState(null)
  const [rotation, setRotation] = useState(0)
  const [zoom, setZoom]     = useState(1)
  const [loaded, setLoaded] = useState(false)
  const [bgRemoving, setBgRemoving] = useState(false)
  const [bgRemoved, setBgRemoved] = useState(false)

  const drag = useRef(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img    = imgRef.current
    if (!canvas || !img || !loaded) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height

    ctx.clearRect(0, 0, W, H)
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.scale(zoom, zoom)
    ctx.drawImage(img, -W / 2, -H / 2, W, H)
    ctx.restore()

    const cx = crop.x * W, cy = crop.y * H, cw = crop.w * W, ch = crop.h * H
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, 0, W, cy)
    ctx.fillRect(0, cy + ch, W, H - cy - ch)
    ctx.fillRect(0, cy, cx, ch)
    ctx.fillRect(cx + cw, cy, W - cx - cw, ch)

    ctx.strokeStyle = '#00d4e8'; ctx.lineWidth = 2
    ctx.strokeRect(cx, cy, cw, ch)

    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(cx + cw*i/3, cy); ctx.lineTo(cx + cw*i/3, cy+ch); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(cx, cy + ch*i/3); ctx.lineTo(cx+cw, cy+ch*i/3); ctx.stroke()
    }

    ctx.fillStyle = '#00d4e8';
    [[cx,cy],[cx+cw,cy],[cx,cy+ch],[cx+cw,cy+ch]].forEach(([x,y]) => ctx.fillRect(x-5,y-5,10,10))
  }, [crop, rotation, zoom, loaded])

  useEffect(() => { draw() }, [draw])

  useEffect(() => {
    const img = new Image()
    img.onload = () => { imgRef.current = img; setLoaded(true); setBgRemoved(false) }
    img.src = `data:${mime};base64,${src}`
  }, [src, mime])

  useEffect(() => {
    if (!ratio) return
    setCrop(c => {
      const newH = c.w / ratio
      const y = Math.max(0, Math.min(c.y, 1 - newH))
      return { ...c, y, h: Math.min(newH, 1 - y) }
    })
  }, [ratio])

  const getZone = (ex, ey) => {
    const canvas = canvasRef.current
    const rect   = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const x = (ex - rect.left) * scaleX
    const y = (ey - rect.top) * scaleY
    const { width: w, height: h } = canvas
    const cx = crop.x*w, cy = crop.y*h, cw = crop.w*w, ch = crop.h*h
    const T = 12
    const inX = x > cx-T && x < cx+cw+T
    const inY = y > cy-T && y < cy+ch+T
    if (!inX || !inY) return null
    const onL = Math.abs(x-cx) < T, onR = Math.abs(x-cx-cw) < T
    const onT = Math.abs(y-cy) < T, onB = Math.abs(y-cy-ch) < T
    if (onT && onL) return 'nw'; if (onT && onR) return 'ne'
    if (onB && onL) return 'sw'; if (onB && onR) return 'se'
    if (onT) return 'n'; if (onB) return 's'
    if (onL) return 'w'; if (onR) return 'e'
    if (x>cx && x<cx+cw && y>cy && y<cy+ch) return 'move'
    return null
  }

  const getCursor = z => ({ nw:'nw-resize',ne:'ne-resize',sw:'sw-resize',se:'se-resize',n:'n-resize',s:'s-resize',w:'w-resize',e:'e-resize',move:'move' }[z] || 'crosshair')
  const [cursor, setCursor] = useState('crosshair')

  const toRel = (px, axis) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scale = axis === 'x' ? canvas.width/rect.width : canvas.height/rect.height
    const dim = axis === 'x' ? canvas.width : canvas.height
    return (px * scale) / dim
  }

  const onMouseMove = (e) => {
    const { clientX: ex, clientY: ey } = e.touches ? e.touches[0] : e
    if (!drag.current) { setCursor(getCursor(getZone(ex, ey))); return }
    const dx = toRel(ex - drag.current.startX, 'x')
    const dy = toRel(ey - drag.current.startY, 'y')
    const sc = { ...drag.current.startCrop }
    let { x, y, w, h } = sc
    const MIN = 0.05
    const { type } = drag.current
    if (type === 'move') {
      x = Math.max(0, Math.min(1-w, sc.x+dx)); y = Math.max(0, Math.min(1-h, sc.y+dy))
    } else {
      if (type.includes('e')) { w = Math.max(MIN, Math.min(1-x, sc.w+dx)) }
      if (type.includes('w')) { const nw = Math.max(MIN, sc.w-dx); x = Math.max(0, sc.x+sc.w-nw); w = nw }
      if (type.includes('s')) { h = Math.max(MIN, Math.min(1-y, sc.h+dy)) }
      if (type.includes('n')) { const nh = Math.max(MIN, sc.h-dy); y = Math.max(0, sc.y+sc.h-nh); h = nh }
    }
    if (ratio && type !== 'move') {
      if (type.includes('n') || type.includes('s')) { w = h*ratio; if (x+w>1){w=1-x;h=w/ratio} }
      else { h = w/ratio; if (y+h>1){h=1-y;w=h*ratio} }
    }
    setCrop({ x, y, w, h })
  }

  const onMouseDown = (e) => {
    const { clientX: ex, clientY: ey } = e.touches ? e.touches[0] : e
    const zone = getZone(ex, ey)
    if (!zone) return
    e.preventDefault()
    drag.current = { type: zone, startX: ex, startY: ey, startCrop: { ...crop } }
  }

  const onMouseUp = () => { drag.current = null }

  const removeBackground = () => {
    const img = imgRef.current
    if (!img || bgRemoving) return
    setBgRemoving(true)

    requestAnimationFrame(() => {
      try {
        const tmp = document.createElement('canvas')
        tmp.width = img.naturalWidth; tmp.height = img.naturalHeight
        const ctx = tmp.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, tmp.width, tmp.height)
        floodFillRemoveBg(imageData, 35)
        ctx.putImageData(imageData, 0, 0)

        const newSrc = tmp.toDataURL('image/png')
        const newImg = new Image()
        newImg.onload = () => {
          imgRef.current = newImg
          setBgRemoved(true)
          setBgRemoving(false)
          draw()
        }
        newImg.src = newSrc
      } catch {
        setBgRemoving(false)
      }
    })
  }

  const apply = () => {
    const img = imgRef.current
    if (!img) return
    const out = document.createElement('canvas')
    const iw = img.naturalWidth, ih = img.naturalHeight
    const sx = crop.x*iw, sy = crop.y*ih
    const sw = crop.w*iw, sh = crop.h*ih
    out.width = Math.round(sw); out.height = Math.round(sh)
    const ctx = out.getContext('2d')

    if (rotation !== 0) {
      const tmp = document.createElement('canvas')
      tmp.width = iw; tmp.height = ih
      const tctx = tmp.getContext('2d')
      tctx.save(); tctx.translate(iw/2, ih/2)
      tctx.rotate((rotation * Math.PI) / 180); tctx.scale(zoom, zoom)
      tctx.drawImage(img, -iw/2, -ih/2); tctx.restore()
      ctx.drawImage(tmp, sx, sy, sw, sh, 0, 0, out.width, out.height)
    } else {
      ctx.drawImage(img, sx*zoom, sy*zoom, sw*zoom, sh*zoom, 0, 0, out.width, out.height)
    }

    const outMime = bgRemoved ? 'image/png' : (mime || 'image/jpeg')
    onDone(out.toDataURL(outMime, 0.92).split(',')[1], outMime)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative rounded-xl overflow-hidden bg-gray-900 dark:bg-black" style={{ lineHeight: 0 }}>
        <canvas
          ref={canvasRef}
          width={600} height={400}
          className="w-full h-auto select-none touch-none"
          style={{ cursor, display: loaded ? 'block' : 'none' }}
          onMouseMove={onMouseMove} onMouseDown={onMouseDown} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
          onTouchMove={e => { e.preventDefault(); onMouseMove(e) }}
          onTouchStart={e => { e.preventDefault(); onMouseDown(e) }}
          onTouchEnd={onMouseUp}
        />
        {!loaded && <div className="w-full h-48 flex items-center justify-center text-gray-400 text-sm">Загрузка...</div>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Соотношение</div>
          <div className="flex flex-wrap gap-1.5">
            {RATIOS.map(r => (
              <button key={r.label} onClick={() => setRatio(r.value)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${ratio === r.value ? 'bg-cyan-600 border-cyan-600 text-white' : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-cyan-400'}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Поворот: {rotation}°</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setRotation(r => r - 90)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-cyan-400 transition">↺ −90°</button>
            <button onClick={() => setRotation(r => r + 90)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-cyan-400 transition">↻ +90°</button>
            <button onClick={() => setRotation(0)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:border-gray-400 transition">Сброс</button>
          </div>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
          Масштаб: {Math.round(zoom * 100)}%
        </div>
        <input type="range" min="0.5" max="3" step="0.05" value={zoom}
          onChange={e => setZoom(Number(e.target.value))}
          className="w-full accent-cyan-600" />
      </div>

      {/* Удаление фона */}
      <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600">
        <div className="flex-1">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Удалить фон</div>
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Flood-fill от краёв изображения. Хорошо работает для белого и однотонного фона.</div>
        </div>
        <button onClick={removeBackground} disabled={bgRemoving || !loaded}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap ${bgRemoved ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700' : 'bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-500 text-gray-700 dark:text-gray-300 hover:border-cyan-400 hover:text-cyan-600'} disabled:opacity-50`}>
          {bgRemoving ? (
            <><span className="animate-spin text-base">⟳</span> Обработка...</>
          ) : bgRemoved ? (
            <><span>✓</span> Фон удалён</>
          ) : (
            <><span className="material-symbols-outlined text-base" style={{fontVariationSettings:"'FILL' 1"}}>auto_fix_high</span> Удалить фон</>
          )}
        </button>
      </div>

      <div className="flex justify-end gap-3 pt-1 border-t border-gray-100 dark:border-gray-700">
        <button onClick={onCancel}
          className="px-5 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition">
          Отмена
        </button>
        <button onClick={apply}
          className="px-6 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-semibold transition flex items-center gap-2">
          <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>crop</span>
          Обрезать и применить
        </button>
      </div>
    </div>
  )
}
