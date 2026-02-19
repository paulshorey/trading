'use client'

const navLinks = [
  { href: '/explore', label: 'Explore' },
  { href: '/science', label: 'Science' },
  { href: '/finance', label: 'Finance' },
  { href: '/careers', label: 'Careers' },
  { href: '/research', label: 'Research' },
  { href: '/about', label: 'About' },
]

interface NavbarProps {
  onNavClick: (title: string) => void
}

export function Navbar({ onNavClick }: NavbarProps) {
  const handleNavClick = (e: React.MouseEvent, label: string) => {
    e.preventDefault()
    onNavClick(`${label} — Coming Soon`)
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-40 border-b border-[var(--color-border)]/50 bg-[var(--color-bg)]/80 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <a
          href="/"
          className="flex items-center gap-0 text-xl font-bold tracking-tight"
          onClick={(e) => handleNavClick(e, 'Home')}
        >
          <span className="text-indigo-400">Eighth</span>
          <span className="gradient-text">Brain</span>
          <span className="text-indigo-400">.ai</span>
        </a>

        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-[var(--color-text-muted)] transition hover:text-[var(--color-text)]"
              onClick={(e) => handleNavClick(e, link.label)}
            >
              {link.label}
            </a>
          ))}
        </div>

        <button
          onClick={() => onNavClick('Get Early Access')}
          className="rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
        >
          Get Early Access
        </button>
      </nav>

      {/* Mobile menu placeholder - same behavior */}
      <div className="flex gap-4 px-6 pb-4 md:hidden">
        {navLinks.slice(0, 3).map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            onClick={(e) => handleNavClick(e, link.label)}
          >
            {link.label}
          </a>
        ))}
      </div>
    </header>
  )
}
