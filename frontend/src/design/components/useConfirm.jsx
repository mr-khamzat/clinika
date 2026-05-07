/**
 * ========================================
 * БЛОК: Хук <ConfirmHost> + useConfirm()
 * ========================================
 * Заменяет нативный window.confirm() на красивый Modal из дизайн-системы.
 *
 * Использование:
 *
 *   const { confirm, ConfirmHost } = useConfirm()
 *   ...
 *   const ok = await confirm('Удалить запись?')
 *   if (!ok) return
 *   ...
 *   return (<>
 *     <ConfirmHost />
 *     ...JSX...
 *   </>)
 *
 * confirm(message, opts?) → Promise<boolean>
 *   opts: { title?: string, okText?: string, cancelText?: string, danger?: boolean }
 * ========================================
 */
import { useCallback, useState } from 'react'
import Modal from './Modal'
import Button from './Button'

export default function useConfirm() {
  // ===== БЛОК: состояние диалога =====
  const [state, setState] = useState({
    open: false,
    message: '',
    title: 'Подтверждение',
    okText: 'Да',
    cancelText: 'Отмена',
    danger: false,
    resolve: null,
  })

  // ===== БЛОК: открыть и вернуть Promise<boolean> =====
  const confirm = useCallback((message, opts = {}) => {
    return new Promise((resolve) => {
      setState({
        open: true,
        message,
        title: opts.title ?? 'Подтверждение',
        okText: opts.okText ?? 'Да',
        cancelText: opts.cancelText ?? 'Отмена',
        danger: !!opts.danger,
        resolve,
      })
    })
  }, [])

  // ===== БЛОК: закрытие c результатом =====
  const close = useCallback((result) => {
    setState((s) => {
      try { s.resolve && s.resolve(result) } catch {}
      return { ...s, open: false, resolve: null }
    })
  }, [])

  // ===== БЛОК: компонент-хост (рендерится единожды в JSX вызывающего) =====
  const ConfirmHost = useCallback(() => (
    <Modal
      open={state.open}
      onClose={() => close(false)}
      title={state.title}
      size="sm"
      actions={
        <>
          <Button variant="secondary" onClick={() => close(false)}>{state.cancelText}</Button>
          <Button variant={state.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{state.okText}</Button>
        </>
      }
    >
      <div style={{ whiteSpace: 'pre-wrap' }}>{state.message}</div>
    </Modal>
  ), [state, close])

  return { confirm, ConfirmHost }
}
