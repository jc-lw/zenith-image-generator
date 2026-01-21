import { Github, History, Settings, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'

interface HeaderProps {
  children?: ReactNode
  onSettingsClick?: () => void
  onHistoryClick?: () => void
  hasToken?: boolean
}

export function Header({ children, onSettingsClick, onHistoryClick, hasToken }: HeaderProps) {
  const { t } = useTranslation()

  return (
    <div className="mb-8 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <a
          href="https://github.com/WuMingDao/zenith-image-generator"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-1.5 border border-zinc-700 rounded-lg text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
        >
          <Github className="w-4 h-4" />
        </a>
        <LanguageSwitcher />
      </div>

      <div className="text-center">
        <h1 className="text-4xl font-bold text-orange-500 drop-shadow-[0_0_10px_rgba(249,115,22,0.5)] tracking-wider">
          {t('header.title')}
        </h1>
        <p className="text-zinc-500 mt-1 text-sm">{t('header.subtitle')}</p>
      </div>

      <div className="flex items-center gap-2">
        {children}
        {onHistoryClick && (
          <button
            type="button"
            onClick={onHistoryClick}
            className="flex items-center gap-2 px-3 py-1.5 border border-zinc-700 rounded-lg text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
          >
            <History className="w-4 h-4" />
            <span className="text-sm">{t('history.title')}</span>
          </button>
        )}
        {onSettingsClick && (
          <button
            type="button"
            onClick={onSettingsClick}
            className="flex items-center gap-2 px-3 py-1.5 border border-zinc-700 rounded-lg text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
          >
            <Settings className="w-4 h-4" />
            <span className="text-sm">{t('common.api')}</span>
            {hasToken && <span className="w-2 h-2 bg-green-500 rounded-full" />}
          </button>
        )}
        <Link
          to="/flow"
          className="flex items-center gap-2 px-3 py-1.5 border border-zinc-700 rounded-lg text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          <span className="text-sm">{t('header.flowMode')}</span>
        </Link>
      </div>
    </div>
  )
}
