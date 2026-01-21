import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Info,
  Loader2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ImageComparison } from '@/components/ui/ImageComparison'
import { upscaleImage } from '@/lib/api'
import { useFlowStore } from '@/stores/flowStore'

export function Lightbox() {
  const { t } = useTranslation()
  const lightboxImageId = useFlowStore((s) => s.lightboxImageId)
  const imageNodes = useFlowStore((s) => s.imageNodes)
  const setLightboxImage = useFlowStore((s) => s.setLightboxImage)

  const [displayUrl, setDisplayUrl] = useState<string | null>(null)

  // Zoom state
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const isDraggingImage = useRef(false)
  const lastMousePos = useRef({ x: 0, y: 0 })

  // Comparison mode state
  const [isComparing, setIsComparing] = useState(false)
  const [tempUpscaledUrl, setTempUpscaledUrl] = useState<string | null>(null)
  const [isUpscaling, setIsUpscaling] = useState(false)

  // UI state
  const [showInfo, setShowInfo] = useState(false)
  const [isBlurred, setIsBlurred] = useState(false)

  const currentImage = imageNodes.find((n) => n.id === lightboxImageId)
  const imagesWithUrls = imageNodes.filter((n) => n.data.imageUrl)

  // Reset state when image changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: lightboxImageId triggers reset even though not used inside
  useEffect(() => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
    setIsComparing(false)
    setTempUpscaledUrl(null)
    setShowInfo(false)
    setIsBlurred(false)
  }, [lightboxImageId])

  // Load URL for display when lightbox opens or image changes
  useEffect(() => {
    if (!currentImage) {
      setDisplayUrl(null)
      return
    }
    setDisplayUrl(currentImage.data.imageUrl || null)
  }, [currentImage])

  const handleClose = useCallback(() => {
    setLightboxImage(null)
  }, [setLightboxImage])

  const handlePrev = useCallback(() => {
    if (imagesWithUrls.length <= 1) return
    const currentIdx = imagesWithUrls.findIndex((n) => n.id === lightboxImageId)
    const prevIdx = (currentIdx - 1 + imagesWithUrls.length) % imagesWithUrls.length
    setLightboxImage(imagesWithUrls[prevIdx].id)
  }, [imagesWithUrls, lightboxImageId, setLightboxImage])

  const handleNext = useCallback(() => {
    if (imagesWithUrls.length <= 1) return
    const currentIdx = imagesWithUrls.findIndex((n) => n.id === lightboxImageId)
    const nextIdx = (currentIdx + 1) % imagesWithUrls.length
    setLightboxImage(imagesWithUrls[nextIdx].id)
  }, [imagesWithUrls, lightboxImageId, setLightboxImage])

  const handleDownload = async () => {
    if (!currentImage) return

    const { imageUrl, seed } = currentImage.data
    const filename = `zenith-${seed}-${Date.now()}.png`

    try {
      if (imageUrl) {
        const { downloadImage } = await import('@/lib/utils')
        await downloadImage(imageUrl, filename)
      }
    } catch (e) {
      console.error('Failed to download image:', e)
    }
  }

  // 4x Upscale with comparison
  const handleUpscale = async () => {
    if (!displayUrl || isUpscaling) return

    setIsUpscaling(true)
    try {
      const result = await upscaleImage(displayUrl, 4)

      if (result.success && result.data.url) {
        setTempUpscaledUrl(result.data.url)
        setIsComparing(true)
        toast.success(t('image.upscaleSuccess', '4x upscale complete! Drag slider to compare.'))
      } else if (!result.success) {
        toast.error(result.error || t('image.upscaleFailed', 'Upscale failed'))
      }
    } catch (_err) {
      toast.error(t('image.upscaleFailed', 'Upscale failed'))
    } finally {
      setIsUpscaling(false)
    }
  }

  // Confirm upscaled image (could update store if needed)
  const handleConfirmUpscale = useCallback(() => {
    if (tempUpscaledUrl) {
      setDisplayUrl(tempUpscaledUrl)
      setTempUpscaledUrl(null)
      setIsComparing(false)
      toast.success(t('image.upscaleConfirmed', 'Upscaled image applied!'))
    }
  }, [tempUpscaledUrl, t])

  // Cancel comparison
  const handleCancelComparison = useCallback(() => {
    setTempUpscaledUrl(null)
    setIsComparing(false)
  }, [])

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setScale((s) => Math.min(s * 1.5, 8))
  }, [])

  const handleZoomOut = useCallback(() => {
    setScale((s) => Math.max(s / 1.5, 1))
  }, [])

  const handleResetZoom = useCallback(() => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }, [])

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.deltaY < 0) {
      setScale((s) => Math.min(s * 1.1, 8))
    } else {
      setScale((s) => Math.max(s / 1.1, 1))
    }
  }, [])

  // Image drag for panning
  const handleImageMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (scale > 1) {
        isDraggingImage.current = true
        lastMousePos.current = { x: e.clientX, y: e.clientY }
      }
    },
    [scale]
  )

  const handleImageMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDraggingImage.current && scale > 1) {
        const dx = e.clientX - lastMousePos.current.x
        const dy = e.clientY - lastMousePos.current.y
        lastMousePos.current = { x: e.clientX, y: e.clientY }
        setPosition((p) => ({ x: p.x + dx, y: p.y + dy }))
      }
    },
    [scale]
  )

  const handleImageMouseUp = useCallback(() => {
    isDraggingImage.current = false
  }, [])

  // Keyboard navigation
  useEffect(() => {
    if (!lightboxImageId) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          if (isComparing) {
            handleCancelComparison()
          } else {
            handleClose()
          }
          break
        case 'ArrowLeft':
          if (!isComparing) handlePrev()
          break
        case 'ArrowRight':
          if (!isComparing) handleNext()
          break
        case '+':
        case '=':
          handleZoomIn()
          break
        case '-':
          handleZoomOut()
          break
        case '0':
          handleResetZoom()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    lightboxImageId,
    isComparing,
    handleClose,
    handlePrev,
    handleNext,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    handleCancelComparison,
  ])

  if (!currentImage || !displayUrl) return null

  const currentIdxInFiltered = imagesWithUrls.findIndex((n) => n.id === lightboxImageId)

  return (
    <AnimatePresence>
      {lightboxImageId && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isComparing) handleClose()
          }}
          onWheel={handleWheel}
        >
          {/* Close button */}
          <button
            type="button"
            onClick={isComparing ? handleCancelComparison : handleClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
          >
            <X size={24} />
          </button>

          {/* Navigation arrows (hidden in compare mode) */}
          {imagesWithUrls.length > 1 && !isComparing && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handlePrev()
                }}
                className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
              >
                <ChevronLeft size={28} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleNext()
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
              >
                <ChevronRight size={28} />
              </button>
            </>
          )}

          {/* Main content area */}
          <div className="relative max-w-[90vw] max-h-[80vh] overflow-hidden">
            {isComparing && tempUpscaledUrl ? (
              /* Comparison mode */
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="max-w-[90vw] max-h-[80vh]"
              >
                <ImageComparison
                  beforeImage={displayUrl}
                  afterImage={tempUpscaledUrl}
                  beforeLabel={t('image.original', 'Original')}
                  afterLabel={t('image.upscaled', '4x Upscaled')}
                  className="max-w-[90vw] max-h-[80vh] shadow-2xl"
                />
              </motion.div>
            ) : (
              /* Normal zoom/pan mode */
              <motion.div
                key={lightboxImageId}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="relative"
                style={{
                  transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
                  cursor: scale > 1 ? 'grab' : 'default',
                }}
                onMouseDown={handleImageMouseDown}
                onMouseMove={handleImageMouseMove}
                onMouseUp={handleImageMouseUp}
                onMouseLeave={handleImageMouseUp}
              >
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard events handled at container level */}
                <img
                  src={displayUrl}
                  alt="Preview"
                  className={`max-w-[90vw] max-h-[80vh] object-contain rounded-lg shadow-2xl transition-all duration-300 ${
                    isBlurred ? 'blur-xl' : ''
                  }`}
                  onClick={(e) => e.stopPropagation()}
                  draggable={false}
                />
              </motion.div>
            )}
          </div>

          {/* Info overlay */}
          {showInfo && currentImage && !isComparing && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute top-20 left-4 p-4 rounded-xl bg-zinc-900/90 border border-zinc-700 text-sm text-zinc-300 space-y-2 max-w-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between">
                <span className="text-zinc-500">Size</span>
                <span>
                  {currentImage.data.width}×{currentImage.data.height}
                </span>
              </div>
              {currentImage.data.seed && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Seed</span>
                  <span className="font-mono">{currentImage.data.seed}</span>
                </div>
              )}
              {currentImage.data.duration && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Duration</span>
                  <span>{currentImage.data.duration}</span>
                </div>
              )}
              {currentImage.data.prompt && (
                <div className="pt-2 border-t border-zinc-700">
                  <span className="text-zinc-500 text-xs">Prompt</span>
                  <p className="mt-1 text-xs line-clamp-4">{currentImage.data.prompt}</p>
                </div>
              )}
            </motion.div>
          )}

          {/* Bottom toolbar */}
          <div
            className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-none"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="toolbar"
          >
            <div className="pointer-events-auto flex items-center gap-1 p-1.5 rounded-2xl bg-black/60 backdrop-blur-md border border-white/10 shadow-2xl">
              {isComparing ? (
                /* Comparison mode toolbar */
                <>
                  <button
                    type="button"
                    onClick={handleCancelComparison}
                    title={t('common.cancel', 'Cancel')}
                    className="flex items-center justify-center w-10 h-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                  <div className="w-px h-5 bg-white/10" />
                  <span className="px-3 text-sm text-white/60">
                    {t('image.dragToCompare', 'Drag slider to compare')}
                  </span>
                  <div className="w-px h-5 bg-white/10" />
                  <button
                    type="button"
                    onClick={handleConfirmUpscale}
                    title={t('image.confirmUpscale', 'Apply upscaled image')}
                    className="flex items-center justify-center w-10 h-10 rounded-xl text-green-400 hover:text-green-300 hover:bg-green-500/10 transition-all"
                  >
                    <Check className="w-5 h-5" />
                  </button>
                </>
              ) : (
                /* Normal mode toolbar */
                <>
                  {/* Counter */}
                  <span className="px-3 text-sm text-zinc-400">
                    {currentIdxInFiltered + 1} / {imagesWithUrls.length}
                  </span>
                  <div className="w-px h-5 bg-white/10" />

                  {/* Info */}
                  <button
                    type="button"
                    onClick={() => setShowInfo(!showInfo)}
                    title={t('image.details', 'Details')}
                    className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all ${
                      showInfo
                        ? 'bg-orange-600 text-white'
                        : 'text-white/70 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <Info className="w-5 h-5" />
                  </button>
                  <div className="w-px h-5 bg-white/10" />

                  {/* Zoom controls */}
                  <button
                    type="button"
                    onClick={handleZoomOut}
                    disabled={scale <= 1}
                    title={t('image.zoomOut', 'Zoom out')}
                    className="flex items-center justify-center w-10 h-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ZoomOut className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleResetZoom}
                    title={t('image.resetZoom', 'Reset zoom')}
                    className="flex items-center justify-center px-2 h-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-all text-xs font-medium min-w-[3rem]"
                  >
                    {Math.round(scale * 100)}%
                  </button>
                  <button
                    type="button"
                    onClick={handleZoomIn}
                    disabled={scale >= 8}
                    title={t('image.zoomIn', 'Zoom in')}
                    className="flex items-center justify-center w-10 h-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ZoomIn className="w-5 h-5" />
                  </button>
                  <div className="w-px h-5 bg-white/10" />

                  {/* 4x Upscale */}
                  <button
                    type="button"
                    onClick={handleUpscale}
                    disabled={isUpscaling}
                    title={
                      isUpscaling
                        ? t('image.upscaling', 'Upscaling...')
                        : t('image.upscale4x', '4x Upscale')
                    }
                    className="flex items-center justify-center w-10 h-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-all disabled:cursor-not-allowed"
                  >
                    {isUpscaling ? (
                      <Loader2 className="w-5 h-5 animate-spin text-orange-400" />
                    ) : (
                      <span className="text-xs font-bold">4x</span>
                    )}
                  </button>
                  <div className="w-px h-5 bg-white/10" />

                  {/* Blur Toggle */}
                  <button
                    type="button"
                    onClick={() => setIsBlurred(!isBlurred)}
                    title={t('image.toggleBlur', 'Toggle Blur')}
                    className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all ${
                      isBlurred
                        ? 'text-orange-400 bg-white/10'
                        : 'text-white/70 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {isBlurred ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                  <div className="w-px h-5 bg-white/10" />

                  {/* Download */}
                  <button
                    type="button"
                    onClick={handleDownload}
                    title={t('common.download', 'Download')}
                    className="flex items-center justify-center w-10 h-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-all"
                  >
                    <Download className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default Lightbox
