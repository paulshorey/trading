'use client'

import { useState } from 'react'
import { Navbar } from '@/components/Navbar'
import { KnowledgeGraph } from '@/components/KnowledgeGraph'
import { ComingSoonModal } from '@/components/ComingSoonModal'

const featuredArticles = [
  { title: 'The Future of AI in Financial Modeling', category: 'Finance', href: '/articles/ai-finance' },
  { title: 'Quantum Computing: A Primer for Engineers', category: 'Science', href: '/articles/quantum-primer' },
  { title: 'From Employee to Entrepreneur in 90 Days', category: 'Careers', href: '/articles/entrepreneur-path' },
  { title: 'Understanding Market Cycles Through Data', category: 'Research', href: '/articles/market-cycles' },
  { title: 'Bioengineering Breakthroughs in 2025', category: 'Science', href: '/articles/bioengineering-2025' },
  { title: 'The Economics of Decentralization', category: 'Economics', href: '/articles/decentralization-economics' },
]

const features = [
  {
    icon: '🔬',
    title: 'Science & Engineering',
    description: 'Deep dives into cutting-edge research, from quantum computing to climate tech.',
  },
  {
    icon: '💰',
    title: 'Commerce & Finance',
    description: 'Master markets, investing, and business. Practical knowledge for wealth building.',
  },
  {
    icon: '📈',
    title: 'Career & Growth',
    description: 'Learn the skills that matter. From technical depth to leadership and entrepreneurship.',
  },
  {
    icon: '🧠',
    title: 'AI-Powered Insights',
    description: 'The web\'s knowledge, synthesized and connected. Ask anything. Learn everything.',
  },
]

export default function HomePage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [modalTitle, setModalTitle] = useState('Get Early Access to Eighth Brain')

  const openModal = (title: string) => {
    setModalTitle(title === 'Get Early Access' ? 'Get Early Access to Eighth Brain' : title)
    setModalOpen(true)
  }

  const handleArticleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    openModal('Explore Articles — Coming Soon')
  }

  return (
    <>
      <Navbar onNavClick={openModal} />

      <main className="relative">
        {/* Hero Section - Full viewport with 3D graph background */}
        <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pt-24 pb-16">
          <KnowledgeGraph />

          <div className="relative z-10 mx-auto max-w-4xl text-center">
            <p className="mb-4 text-sm font-medium uppercase tracking-[0.2em] text-indigo-400">
              The AI-Powered Knowledge Universe
            </p>
            <h1 className="mb-6 text-5xl font-bold leading-tight tracking-tight sm:text-6xl md:text-7xl">
              The World&apos;s Knowledge,
              <br />
              <span className="gradient-text">Connected & Intelligent</span>
            </h1>
            <p className="mx-auto mb-10 max-w-2xl text-lg text-[var(--color-text-muted)] sm:text-xl">
              Science. Engineering. Commerce. Finance. An AI crawls the web to learn in-depth—so you can master any
              subject, advance your career, or build something new. Your path to expertise starts here.
            </p>
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <button
                onClick={() => openModal('Get Early Access')}
                className="animate-pulse-glow rounded-full bg-indigo-600 px-8 py-4 text-lg font-semibold text-white transition hover:bg-indigo-500"
              >
                Get Early Access
              </button>
              <a
                href="#explore"
                className="rounded-full border border-[var(--color-border)] px-8 py-4 text-lg font-semibold transition hover:border-indigo-500/50 hover:bg-indigo-500/10"
              >
                Explore What&apos;s Coming
              </a>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="relative border-t border-[var(--color-border)]/50 bg-[var(--color-bg-elevated)] py-24">
          <div className="mx-auto max-w-7xl px-6">
            <h2 className="mb-4 text-center text-sm font-medium uppercase tracking-[0.2em] text-indigo-400">
              Built for the Curious
            </h2>
            <p className="mx-auto mb-16 max-w-2xl text-center text-3xl font-bold sm:text-4xl">
              One platform. Every domain. AI that learns so you can grow.
            </p>
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 transition hover:border-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/5"
                >
                  <div className="mb-4 text-3xl">{f.icon}</div>
                  <h3 className="mb-2 text-lg font-semibold">{f.title}</h3>
                  <p className="text-sm text-[var(--color-text-muted)]">{f.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Featured Articles - Teaser Links */}
        <section id="explore" className="relative py-24">
          <div className="mx-auto max-w-7xl px-6">
            <h2 className="mb-4 text-center text-sm font-medium uppercase tracking-[0.2em] text-indigo-400">
              Coming Soon
            </h2>
            <p className="mx-auto mb-16 max-w-2xl text-center text-3xl font-bold sm:text-4xl">
              Articles, research, and insights—powered by AI
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {featuredArticles.map((article) => (
                <a
                  key={article.href}
                  href={article.href}
                  onClick={handleArticleClick}
                  className="group flex items-start gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 transition hover:border-indigo-500/40 hover:bg-[var(--color-bg-elevated)]"
                >
                  <span className="rounded-lg bg-indigo-500/20 px-2 py-1 text-xs font-medium text-indigo-400">
                    {article.category}
                  </span>
                  <div>
                    <h3 className="font-semibold transition group-hover:text-indigo-400">{article.title}</h3>
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">Click to preview →</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative border-t border-[var(--color-border)]/50 bg-[var(--color-bg-elevated)] py-24">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <h2 className="mb-4 text-3xl font-bold sm:text-4xl">
              Join the waitlist.
              <br />
              <span className="gradient-text">Shape the future of knowledge.</span>
            </h2>
            <p className="mb-8 text-[var(--color-text-muted)]">
              Be first to explore the AI-powered knowledge base. No spam. Early access only.
            </p>
            <button
              onClick={() => openModal('Get Early Access')}
              className="rounded-full bg-indigo-600 px-10 py-4 text-lg font-semibold text-white transition hover:bg-indigo-500"
            >
              Get Early Access
            </button>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-[var(--color-border)]/50 py-8">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
            <span className="font-semibold gradient-text">Eighth Brain</span>
            <div className="flex gap-8 text-sm text-[var(--color-text-muted)]">
              <a
                href="/privacy"
                onClick={(e) => {
                  e.preventDefault()
                  openModal('Privacy Policy — Coming Soon')
                }}
                className="hover:text-[var(--color-text)]"
              >
                Privacy
              </a>
              <a
                href="/terms"
                onClick={(e) => {
                  e.preventDefault()
                  openModal('Terms of Service — Coming Soon')
                }}
                className="hover:text-[var(--color-text)]"
              >
                Terms
              </a>
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-[var(--color-text-muted)]">
            © {new Date().getFullYear()} Eighth Brain. All rights reserved. eighthbrain.ai
          </p>
        </footer>
      </main>

      <ComingSoonModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modalTitle}
      />
    </>
  )
}
