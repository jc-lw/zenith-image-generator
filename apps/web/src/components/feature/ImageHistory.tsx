import { X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { HistoryItem } from '@/components/feature/HistoryItem'
import {
  clearAllHistory,
  clearExpiredHistory,
  getHistory,
  getHistoryStats,
  type ImageHistoryItem,
  deleteHistoryItem,
} from '@/lib/historyStore'

interface ImageHistoryProps {
  open: boolean
  onClose: () => void
  onSelect?: (item: ImageHistoryItem) => void
}

export function ImageHistory({ open, onClose, onSelect }: ImageHistoryProps) {
  const { t } = useTranslation()
  const [items, setItems] = useState<ImageHistoryItem[]>([])
  const [stats, setStats] = useState(() => getHistoryStats())

  const refresh = useCallback(() => {
    // Enforce TTL cleanup on every open/refresh.
    clearExpiredHistory()
    setItems(getHistory())
    setStats(getHistoryStats())
  }, [])

  useEffect(() => {
    if (!open) return
    refresh()
  }, [open, refresh])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const title = useMemo(() => {
    if (stats.total === 0) return t('history.emptyTitle')
    return t('history.titleWithCount', { count: stats.total })
  }, [stats.total, t])

  const handleClearAll = () => {
    if (!confirm(t('history.clearAllConfirm'))) return
    clearAllHistory()
    refresh()
    toast.success(t('history.clearedAll'))
  }

  const handleClearExpired = () => {
    const cleared = clearExpiredHistory()
    refresh()
    if (cleared > 0) toast.success(t('history.clearedExpired', { count: cleared }))
    else toast.info(t('history.noExpired'))
  }

  const handleDelete = (id: string) => {
    deleteHistoryItem(id)
    refresh()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label={t('common.cancel')}
      />

      <div className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-zinc-100">{title}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{t('history.ttlHint')}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
            aria-label={t('common.cancel')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-zinc-800 flex items-center gap-2">
          <button
            type="button"
            onClick={handleClearExpired}
            className="px-3 py-1.5 rounded-lg border border-zinc-800 text-xs text-zinc-300 hover:bg-zinc-900/40 transition-colors"
          >
            {t('history.clearExpired')}
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            className="px-3 py-1.5 rounded-lg border border-zinc-800 text-xs text-red-300 hover:bg-red-500/10 transition-colors"
          >
            {t('history.clearAll')}
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-3">
          {items.length === 0 ? (
            <div className="text-sm text-zinc-500">{t('history.emptyBody')}</div>
          ) : (
            items.map((item) => (
              <HistoryItem key={item.id} item={item} onSelect={onSelect} onDelete={handleDelete} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
