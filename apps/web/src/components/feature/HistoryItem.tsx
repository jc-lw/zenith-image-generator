import { Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ImageHistoryItem as ImageHistoryItemType } from '@/lib/historyStore'

interface HistoryItemProps {
  item: ImageHistoryItemType
  onSelect?: (item: ImageHistoryItemType) => void
  onDelete?: (id: string) => void
}

export function HistoryItem({ item, onSelect, onDelete }: HistoryItemProps) {
  const { t } = useTranslation()
  const [thumbError, setThumbError] = useState(false)

  const isExpired = useMemo(() => Date.now() > item.expiresAt, [item.expiresAt])

  return (
    <div className="flex gap-3 p-3 rounded-xl border border-zinc-800 bg-zinc-950/40 hover:bg-zinc-900/30 transition-colors">
      <button
        type="button"
        onClick={() => onSelect?.(item)}
        className="w-16 h-16 rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0"
        title={t('history.load')}
      >
        {!thumbError ? (
          <img
            src={item.url}
            alt={item.prompt}
            className="w-full h-full object-cover"
            onError={() => setThumbError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500">
            {t('history.thumbnailFailed')}
          </div>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => onSelect?.(item)}
            className="text-left min-w-0"
            title={t('history.load')}
          >
            <div className="text-sm text-zinc-200 truncate">{item.prompt}</div>
            <div className="text-xs text-zinc-500 mt-0.5">
              {item.providerName} / {item.modelName} · {item.width}x{item.height} · seed {item.seed}
            </div>
          </button>

          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              className="p-2 rounded-lg text-zinc-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
              title={t('common.delete')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 mt-2">
          {isExpired && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-300 border border-yellow-500/20">
              {t('history.expired')}
            </span>
          )}
          <span className="text-[10px] text-zinc-600">
            {new Date(item.timestamp).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  )
}
