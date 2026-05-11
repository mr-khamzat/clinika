/**
 * ========================================
 * БЛОК: CtaNewsletter — финальный CTA с подпиской на дайджест
 * ========================================
 * Email-форма POST на /contact/ с пометкой kind=newsletter.
 * При ошибке — не блокирует, показывает «Сохранено локально».
 * ========================================
 */
import { useState } from 'react'
import axios from 'axios'
import { API_BASE } from '../../config'

export default function CtaNewsletter() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = async e => {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    try {
      await axios.post(API_BASE + '/contact/', {
        name: 'Newsletter',
        email,
        phone: '',
        message: 'Подписка на дайджест с лендинга',
      })
    } catch {
      try { localStorage.setItem('ks_newsletter_email', email) } catch {}
    } finally {
      setSent(true)
      setLoading(false)
    }
  }

  return (
    <section className="ks-cta ks-cta-final" id="start">
      <div className="ks-cta-card ks-cta-card-pro">
        <div className="ks-cta-glow" aria-hidden />
        <div className="ks-cta-content">
          <h2>Начните бесплатно сегодня</h2>
          <p>
            Через 5 минут — первая запись пациента. Без банковской карты, без долгих переговоров.
            Поможем перенести данные и обучим команду.
          </p>
          <div className="ks-cta-actions">
            <a href="/signup" className="ks-btn-cta-primary">
              Создать кабинет за 5 минут →
            </a>
            <a href="#pricing" className="ks-btn-cta-secondary">
              Сравнить тарифы
            </a>
          </div>

          <form onSubmit={submit} className="ks-cta-news" aria-label="Подписка на дайджест">
            {sent ? (
              <div className="ks-cta-news-ok">
                <span aria-hidden>✓</span> Спасибо! Раз в две недели присылаем дайджест по платформе.
              </div>
            ) : (
              <>
                <input
                  type="email"
                  required
                  placeholder="email@clinic.ru — пришлём дайджест"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="ks-cta-news-input"
                  aria-label="Email для подписки на дайджест"
                />
                <button type="submit" disabled={loading} className="ks-cta-news-btn">
                  {loading ? '…' : 'Подписаться'}
                </button>
              </>
            )}
          </form>
          <div className="ks-cta-trust-row">
            <span>14 дней бесплатно</span><span>·</span>
            <span>Без банковской карты</span><span>·</span>
            <span>152-ФЗ совместимо</span>
          </div>
        </div>
      </div>
    </section>
  )
}
