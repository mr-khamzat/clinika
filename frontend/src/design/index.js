/**
 * ========================================
 * БЛОК: Дизайн-система · публичный API
 * ========================================
 * Реэкспорты компонентов и токенов, чтобы импортировать так:
 *
 *   import { Page, Card, KpiCard, Button, Modal, useToast } from '@/design'
 *
 * Токены подгружаются через ./tokens.css (обычно в main.jsx, один раз глобально).
 * ========================================
 */
export { default as Page } from './components/Page'
export { default as PageHeader } from './components/PageHeader'
export { default as Card } from './components/Card'
export { default as KpiCard } from './components/KpiCard'
export { default as KpiRow } from './components/KpiRow'
export { default as Chip } from './components/Chip'
export { default as Button } from './components/Button'
export { default as Tabs } from './components/Tabs'
export { default as Avatar } from './components/Avatar'
export { default as EmptyState } from './components/EmptyState'
export { default as Sparkline } from './components/Sparkline'
export { default as Modal } from './components/Modal'
export { default as Toast } from './components/Toast'
export { ToastProvider, useToast } from './components/ToastContext'
export { default as useConfirm } from './components/useConfirm'
export { default as InfoHint } from './components/InfoHint'
export { default as ClinicScopeSelector } from './components/ClinicScopeSelector'
