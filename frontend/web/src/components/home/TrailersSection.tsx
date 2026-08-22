import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { trailers } from './placeholders'
import type { Trailer } from './placeholders'
import { ImagePlaceholder } from '../ui/ImagePlaceholder'

const controlButton = 'inline-block border-0 rounded-lg bg-(--color-accent) text-gray-800 cursor-pointer font-sans font-bold px-4 py-2 hover:opacity-90 transition-opacity'

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
      void video.play()
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
      <>
        <video
          ref={videoRef}
          src={src}
          poster={capa}
          autoPlay
          muted
          playsInline
          preload="none"
          className="w-full aspect-video rounded-xl bg-black"
          onError={() => setFailed(true)}
          onCanPlay={() => setReady(true)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={togglePlay} className={controlButton}>{playing ? trailers.labels.pause : trailers.labels.play}</button>
          <button type="button" onClick={toggleMute} className={controlButton}>{muted ? trailers.labels.som : trailers.labels.mudo}</button>
          {!ready && <p role="status" className="text-(--color-muted) text-sm m-0">{trailers.mensagens.carregando}</p>}
        </div>
      </>
    )
  } else {
    media = (
      <div>
        <ImagePlaceholder alt={titulo} src={capa} />
        <div className="mt-3">
          <button type="button" onClick={() => setRequested(true)} className={controlButton}>{trailers.labels.play}</button>
        </div>
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
