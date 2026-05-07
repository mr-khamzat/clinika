/**
 * ========================================
 * СТРАНИЦА: /design-system — витрина компонентов
 * ========================================
 * Демонстрирует все базовые компоненты дизайн-системы из /src/design/.
 * Доступ: super_admin (защита через App.jsx); если без auth — просто отрендерится.
 *
 * Источник истины — design-preview-2 (HTML-макеты в /public/design2/).
 * ========================================
 */
import { useState } from 'react'
import {
  Page,
  PageHeader,
  Card,
  KpiCard,
  KpiRow,
  Chip,
  Button,
  Tabs,
  Avatar,
  EmptyState,
  Sparkline,
  Modal,
  useToast,
} from '../design'

export default function DesignSystem() {
  // ─── Состояние демо ───
  const [theme, setTheme] = useState('light')
  const [tab, setTab] = useState('overview')
  // ─── Состояние демо: Modal ───
  const [modalOpen, setModalOpen] = useState(false)
  const [modalSize, setModalSize] = useState('md')
  // ─── Хук тостов ───
  const { toast } = useToast()

  return (
    <Page theme={theme}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8">
        <PageHeader
          title="Design System · КлиникСеть"
          subtitle="Дизайн-токены и базовые компоненты в стиле design-preview-2"
          actions={
            <>
              <Tabs
                items={[
                  { id: 'light', label: 'Светлая' },
                  { id: 'dark', label: 'Тёмная' },
                ]}
                value={theme}
                onChange={setTheme}
              />
              <Button variant="primary">Готов к миграции</Button>
            </>
          }
        />

        {/* ─── Цветовые токены ─── */}
        <Card className="mb-6">
          <Card.Header>
            <div>
              <Card.Title>Цветовые токены</Card.Title>
              <Card.Subtitle>CSS-переменные из tokens.css</Card.Subtitle>
            </div>
          </Card.Header>
          <Card.Body>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {[
                { name: '--accent', v: 'var(--accent)' },
                { name: '--accent-2', v: 'var(--accent-2)' },
                { name: '--accent-soft', v: 'var(--accent-soft)' },
                { name: '--good', v: 'var(--good)' },
                { name: '--warn', v: 'var(--warn)' },
                { name: '--bad', v: 'var(--bad)' },
                { name: '--gold', v: 'var(--gold)' },
                { name: '--bg', v: 'var(--bg)' },
                { name: '--bg-1', v: 'var(--bg-1)' },
                { name: '--bg-2', v: 'var(--bg-2)' },
                { name: '--surface', v: 'var(--surface)' },
                { name: '--border', v: 'var(--border)' },
              ].map((t) => (
                <div
                  key={t.name}
                  className="flex flex-col gap-2"
                  style={{ fontSize: 11.5, color: 'var(--fg-3)' }}
                >
                  <div
                    style={{
                      height: 56,
                      borderRadius: 'var(--radius-sm)',
                      background: t.v,
                      border: '1px solid var(--border)',
                    }}
                  />
                  <code style={{ color: 'var(--fg-2)' }}>{t.name}</code>
                </div>
              ))}
            </div>
          </Card.Body>
        </Card>

        {/* ─── KPI ─── */}
        <KpiRow className="mb-6">
          <KpiCard label="Пациенты сегодня" value="48" delta="+12% к вчера" trend="up" />
          <KpiCard label="Выручка, ₽" value="312 400" delta="+4.2%" trend="up" />
          <KpiCard label="Отмены" value="3" delta="-2" trend="down" />
          <KpiCard label="NPS" value="78" delta="без изменений" trend="flat" />
        </KpiRow>

        {/* ─── Кнопки ─── */}
        <Card className="mb-6">
          <Card.Header>
            <Card.Title>Кнопки</Card.Title>
          </Card.Header>
          <Card.Body>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="primary" size="sm">Small</Button>
              <Button variant="primary" size="lg">Large</Button>
              <Button variant="primary" disabled>Disabled</Button>
            </div>
          </Card.Body>
        </Card>

        {/* ─── Чипы ─── */}
        <Card className="mb-6">
          <Card.Header>
            <Card.Title>Chips / Pills</Card.Title>
          </Card.Header>
          <Card.Body>
            <div className="flex flex-wrap items-center gap-2">
              <Chip>Нейтральный</Chip>
              <Chip variant="accent" dot>Активный</Chip>
              <Chip variant="good" dot>Подтверждён</Chip>
              <Chip variant="warn" dot>В ожидании</Chip>
              <Chip variant="bad" dot>Отменён</Chip>
            </div>
          </Card.Body>
        </Card>

        {/* ─── Tabs ─── */}
        <Card className="mb-6">
          <Card.Header>
            <Card.Title>Tabs</Card.Title>
          </Card.Header>
          <Card.Body>
            <Tabs
              items={[
                { id: 'overview', label: 'Обзор' },
                { id: 'patients', label: 'Пациенты', badge: 12 },
                { id: 'revenue', label: 'Выручка' },
                { id: 'team', label: 'Команда' },
              ]}
              value={tab}
              onChange={setTab}
            />
            <p className="mt-3" style={{ color: 'var(--fg-3)', fontSize: 13 }}>
              Активна вкладка: <strong style={{ color: 'var(--fg)' }}>{tab}</strong>
            </p>
          </Card.Body>
        </Card>

        {/* ─── Аватары ─── */}
        <Card className="mb-6">
          <Card.Header>
            <Card.Title>Avatars</Card.Title>
          </Card.Header>
          <Card.Body>
            <div className="flex flex-wrap items-end gap-4">
              <Avatar name="Хамзат Темирсултанов" size="sm" />
              <Avatar name="Хамзат Темирсултанов" size="md" />
              <Avatar name="Хамзат Темирсултанов" size="lg" />
              <Avatar name="Хамзат Темирсултанов" size="xl" />
              <Avatar name="A B" size="lg" />
            </div>
          </Card.Body>
        </Card>

        {/* ─── Sparkline ─── */}
        <Card className="mb-6">
          <Card.Header>
            <div>
              <Card.Title>Sparkline</Card.Title>
              <Card.Subtitle>Простой SVG-график без внешних зависимостей</Card.Subtitle>
            </div>
          </Card.Header>
          <Card.Body>
            <div className="flex flex-wrap items-center gap-6">
              <Sparkline data={[3, 5, 4, 7, 6, 9, 8, 12, 10, 14]} width={200} height={48} />
              <Sparkline
                data={[14, 12, 10, 11, 9, 8, 7, 6, 8, 5]}
                width={200}
                height={48}
                stroke="var(--bad)"
                fill="var(--bad-soft)"
              />
              <Sparkline
                data={[5, 6, 5, 6, 5, 6, 7, 8, 7, 8]}
                width={200}
                height={48}
                stroke="var(--good)"
                fill="var(--good-soft)"
              />
            </div>
          </Card.Body>
        </Card>

        {/* ─── EmptyState ─── */}
        <Card className="mb-6">
          <Card.Header>
            <Card.Title>Empty State</Card.Title>
          </Card.Header>
          <Card.Body>
            <EmptyState
              icon={<span aria-hidden>📂</span>}
              title="Записей пока нет"
              message="Когда пациенты начнут оставлять заявки, они появятся здесь."
              action={<Button variant="primary">Создать запись</Button>}
            />
          </Card.Body>
        </Card>

        {/* ─── Modal ─── */}
        <Card className="mb-6">
          <Card.Header>
            <div>
              <Card.Title>Modal</Card.Title>
              <Card.Subtitle>Backdrop с blur, focus-trap, Esc, на мобильном — bottom-sheet</Card.Subtitle>
            </div>
          </Card.Header>
          <Card.Body>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                onClick={() => {
                  setModalSize('sm')
                  setModalOpen(true)
                }}
              >
                Открыть Small
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setModalSize('md')
                  setModalOpen(true)
                }}
              >
                Открыть Medium
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setModalSize('lg')
                  setModalOpen(true)
                }}
              >
                Открыть Large
              </Button>
            </div>
          </Card.Body>
        </Card>

        {/* ─── Toast ─── */}
        <Card className="mb-6">
          <Card.Header>
            <div>
              <Card.Title>Toast</Card.Title>
              <Card.Subtitle>useToast() — справа-снизу (на мобильном — сверху)</Card.Subtitle>
            </div>
          </Card.Header>
          <Card.Body>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                onClick={() => toast('Информационное сообщение', 'info')}
              >
                Info
              </Button>
              <Button
                variant="primary"
                onClick={() => toast('Изменения сохранены', 'success')}
              >
                Success
              </Button>
              <Button
                variant="secondary"
                onClick={() => toast('Проверьте подключение к сети', 'warn')}
              >
                Warn
              </Button>
              <Button
                variant="danger"
                onClick={() => toast('Не удалось загрузить данные', 'error', 6000)}
              >
                Error (6с)
              </Button>
            </div>
          </Card.Body>
        </Card>

        {/* ─── Footer note ─── */}
        <p className="text-center mt-8" style={{ fontSize: 12, color: 'var(--fg-4)' }}>
          Этап 4 ROADMAP · Дизайн-токены + базовые компоненты · /src/design/
        </p>
      </div>

      {/* ─── Modal: рендер вне Page-контейнера (portal-like) ─── */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Пример модалки (${modalSize})`}
        size={modalSize}
        actions={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setModalOpen(false)
                toast('Действие подтверждено', 'success')
              }}
            >
              Подтвердить
            </Button>
          </>
        }
      >
        <p>
          Это переиспользуемая модалка дизайн-системы. Поддерживает три размера
          ({"'sm'"}, {"'md'"}, {"'lg'"}), backdrop с blur, focus-trap, закрытие по Esc.
        </p>
        <p className="mt-3">
          На экранах уже 640px рендерится как bottom-sheet со slide-up анимацией.
        </p>
      </Modal>
    </Page>
  )
}
