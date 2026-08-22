import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { trailers } from './placeholders'
import type { Trailer } from './placeholders'
import { ImagePlaceholder } from '../ui/ImagePlaceholder'

const controlButton =
  'inline-flex h-9 w-9 items-center justify-center border-0 rounded-full bg-transparent p-0 text-white cursor-pointer hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-(--color-accent) transition-colors'

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
    </svg>
  )
}

function SoundIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1c2.9.9 5 3.6 5 6.7s-2.1 5.8-5 6.7v2.1c4-.9 7-4.5 7-8.8s-3-7.9-7-8.8z" />
    </svg>
  )
}

function MutedIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M16.5 12A4.5 4.5 0 0 0 14 8v2.2l2.5 2.5v-.7zM19 12c0 .9-.2 1.8-.5 2.6l1.5 1.5A9.7 9.7 0 0 0 21 12c0-4.3-3-7.9-7-8.8v2.1c2.9.9 5 3.6 5 6.7zM4.3 3L3 4.3 7.7 9H3v6h4l5 5v-6.7l4.3 4.3c-.7.5-1.4.9-2.3 1.2v2.1c1.4-.3 2.6-1 3.7-1.8l2 2 1.3-1.3-3-2.9L4.3 3zM12 4L9.9 6.1 12 8.2V4z" />
    </svg>
  )
}

function TrailerPlayer({ trailer }: { trailer: Trailer }) {
  const { titulo, capa, src } = trailer
  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [inView, setInView] = useState(false)
  const [requested, setRequested] = useState(false)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)

  useEffect(() => {
    const node = containerRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setInView(true)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (playing) {
      video.pause()
      setPlaying(false)
    } else {
      video
        .play()
        .catch(() => setPlaying(false))
      setPlaying(true)
    }
  }

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    if (videoRef.current) videoRef.current.muted = next
  }

  const shouldLoad = Boolean(src) && (inView || requested)

  let media: ReactNode
  if (!src) {
    media = (
      <div
        className="flex w-full aspect-video items-center justify-center rounded-xl border border-dashed border-(--color-muted) bg-linear-to-br from-(--color-surface) via-(--color-background) to-(--color-surface)"
        role="img"
        aria-label={titulo}
      >
        <span className="text-(--color-muted) text-sm italic px-6 text-center">{trailers.mensagens.indisponivel}</span>
      </div>
    )
  } else if (failed) {
    media = (
      <div>
        <ImagePlaceholder alt={titulo} src={capa} />
        <p role="status" className="mt-3 text-(--color-muted) text-sm">{trailers.mensagens.falha}</p>
      </div>
    )
  } else if (shouldLoad && src) {
    media = (
      <div className="relative w-full aspect-video overflow-hidden rounded-xl bg-black group">
        <video
          ref={videoRef}
          src={src}
          poster={capa}
          autoPlay
          muted
          playsInline
          preload="none"
          onClick={togglePlay}
          onError={() => setFailed(true)}
          onCanPlay={() => setReady(true)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className="w-full h-full object-contain"
        />
        {!ready && (
          <p role="status" className="absolute top-3 left-3 m-0 rounded-md bg-black/70 px-3 py-1 text-white text-sm">
            {trailers.mensagens.carregando}
          </p>
        )}
      <div
        data-testid="trailer-controls"
        className={`absolute inset-x-0 bottom-0 flex items-center gap-1 px-2 pt-10 pb-2 bg-linear-to-t from-black/80 via-black/40 to-transparent transition-opacity duration-200 ${
            !playing || !ready
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          }`}
        >
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? trailers.labels.pause : trailers.labels.play}
            className={controlButton}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? trailers.labels.som : trailers.labels.mudo}
            className={controlButton}
          >
            {muted ? <MutedIcon /> : <SoundIcon />}
          </button>
        </div>
      </div>
    )
  } else {
    media = (
      <div className="relative overflow-hidden rounded-xl">
        <ImagePlaceholder alt={titulo} src={capa} />
        <button
          type="button"
          onClick={() => setRequested(true)}
          aria-label={trailers.labels.play}
          className="absolute inset-0 m-auto inline-flex h-16 w-16 items-center justify-center border-0 rounded-full bg-black/60 text-white cursor-pointer hover:bg-(--color-accent) hover:text-gray-800 focus-visible:outline-2 focus-visible:outline-(--color-accent) transition-colors"
        >
          <PlayIcon />
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef}>
      <h3 className="text-[clamp(1.125rem,2vw,1.375rem)] font-bold text-center mb-4">{titulo}</h3>
      {media}
    </div>
  )
}

export function TrailersSection() {
  return (
    <section id={trailers.id} className="py-[clamp(3rem,8vh,6rem)] px-8 bg-(--color-surface)" aria-labelledby="trailers-title">
      <div className="max-w-7xl mx-auto">
        <h2 id="trailers-title" className="text-[clamp(1.75rem,4vw,2.5rem)] text-center mb-2">{trailers.title}</h2>
        <p className="text-(--color-muted) leading-relaxed text-center max-w-2xl mb-10 mx-auto">{trailers.description}</p>
        <ul role="list" className="grid grid-cols-1 gap-12 list-none m-0 p-0">
          {trailers.items.map((item) => (
            <li key={item.titulo} className="w-full max-w-3xl mx-auto">
              <TrailerPlayer trailer={item} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
