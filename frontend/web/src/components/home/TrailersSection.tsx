import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { trailers } from './placeholders'
import type { Trailer } from './placeholders'

const controlButton =
  'inline-flex h-9 w-9 items-center justify-center border-0 rounded-full bg-transparent p-0 text-white cursor-pointer hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-accent transition-colors'

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

function TrailerCover({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div
      className="trailers-cover group flex w-full aspect-video items-center justify-center rounded-none border-0 bg-linear-to-br from-surface via-background to-surface"
      role="img"
      aria-label={titulo}
    >
      {children}
    </div>
  )
}

function TrailerPlayer({ trailer }: { trailer: Trailer }) {
  const { titulo, descricao, capa, src } = trailer
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
      if (entries.some((entry) => entry.isIntersecting)) {
        setInView(true)
        observer.unobserve(node)
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (playing) {
      video.pause()
    } else {
      video
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false))
    }
  }

  const toggleMute = () => {
    setMuted((prev) => !prev)
  }

  const handleVideoKeyDown = (event: KeyboardEvent<HTMLVideoElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      togglePlay()
    }
  }

  const shouldLoad = Boolean(src) && (inView || requested)
  const playPauseLabel = playing ? trailers.labels.pause : trailers.labels.play

  let media: ReactNode
  if (!src) {
    media = (
      <TrailerCover titulo={titulo}>
        <span className="flex flex-col items-center gap-4 px-6 text-center">
          <span aria-hidden="true" className="trailers-play-decorative">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          <span className="text-muted text-sm italic text-center">{trailers.mensagens.indisponivel}</span>
        </span>
      </TrailerCover>
    )
  } else if (failed) {
    media = (
      <div>
        <TrailerCover titulo={titulo}>
          {capa ? <img src={capa} alt="" className="w-full h-full object-cover rounded-none" /> : null}
        </TrailerCover>
        <p role="status" className="mt-3 text-muted text-sm">{trailers.mensagens.falha}</p>
      </div>
    )
  } else if (shouldLoad) {
    media = (
      <div className="relative w-full aspect-video overflow-hidden rounded-none bg-black group">
        <video
          ref={videoRef}
          src={src}
          poster={capa}
          autoPlay
          muted={muted}
          playsInline
          preload="none"
          role="button"
          tabIndex={0}
          aria-label={playPauseLabel}
          onClick={togglePlay}
          onKeyDown={handleVideoKeyDown}
          onError={() => setFailed(true)}
          onCanPlay={() => setReady(true)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className="w-full h-full object-contain cursor-pointer"
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
            aria-label={playPauseLabel}
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
      <div className="group relative overflow-hidden rounded-none">
        {capa ? (
          <img src={capa} alt={titulo} className="flex w-full aspect-video overflow-hidden rounded-none border-0 object-cover" />
        ) : (
          <div
            role="img"
            aria-label={titulo}
            className="flex w-full aspect-video items-center justify-center overflow-hidden rounded-none border-0 bg-surface"
          />
        )}
        <button
          type="button"
          onClick={() => setRequested(true)}
          aria-label={trailers.labels.play}
          className="trailers-play absolute inset-0 m-auto inline-flex h-16 w-16 items-center justify-center border-0 rounded-full bg-black/60 text-white cursor-pointer hover:bg-accent hover:text-gray-800 focus-visible:outline-2 focus-visible:outline-accent transition-colors"
        >
          <PlayIcon />
        </button>
      </div>
    )
  }

  // Ramo placeholder (!src): card relativo com capa ao fundo, círculo de
  // play DECORATIVO centralizado e rótulo em overlay inferior-esquerdo.
  // O círculo é `aria-hidden` sem `role="button"` nem handler — preserva
  // `queryByRole('button') === null`. O `h3` segue no DOM para leitores de
  // tela, só muda estilo/posição (caps via CSS).
  if (!src) {
    return (
      <div ref={containerRef} className="group">
        <div className="trailers-card relative aspect-video w-full overflow-hidden rounded-none">
          {media}
          <h3 className="trailers-card-label">{titulo}</h3>
        </div>
        <p className="mt-3 text-muted text-sm leading-relaxed">{descricao}</p>
      </div>
    )
  }

  return (
    <div ref={containerRef}>
      <h3 className="text-[clamp(1.125rem,2vw,1.375rem)] font-bold text-center mb-4">{titulo}</h3>
      {media}
      <p className="mt-3 text-muted text-sm leading-relaxed text-center">{descricao}</p>
    </div>
  )
}

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  // Sem IntersectionObserver (ex.: jsdom, ambientes sem suporte), nasce
  // revelado — fallback estático sem JS/observer com conteúdo visível.
  const [revealed, setRevealed] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )

  // Reveal único de entrada por elemento: observa o próprio nó uma vez e
  // revela; sem IntersectionObserver o estado inicial já é revelado
  // (fallback estático). O estado inicial oculto só existe via JS — sem
  // JS/observer o conteúdo segue visível. Espelha o padrão da HeroSection.
  useEffect(() => {
    if (revealed) return
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [revealed])

  return { ref, revealState: revealed ? 'is-visible' : 'is-hidden' }
}

function TrailerRevealItem({ index, children }: { index: number; children: ReactNode }) {
  const { ref, revealState } = useReveal<HTMLLIElement>()
  return (
    <li
      ref={ref}
      style={{ transitionDelay: `${index * 90}ms` }}
      className={`trailers-reveal ${revealState} w-full`}
    >
      {children}
    </li>
  )
}

export function TrailersSection() {
  const { ref: titleRef, revealState: titleState } = useReveal<HTMLHeadingElement>()

  return (
    <section id={trailers.id} className="py-[clamp(3rem,8vh,6rem)] px-8 bg-surface" aria-labelledby="trailers-title">
      <div className="max-w-7xl mx-auto">
        <h2 ref={titleRef} id="trailers-title" className={`trailers-eyebrow trailers-reveal ${titleState}`}>{trailers.title}</h2>
        <ul role="list" className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 list-none m-0 p-0">
          {trailers.items.map((item, index) => (
            <TrailerRevealItem key={item.titulo} index={index}>
              <TrailerPlayer trailer={item} />
            </TrailerRevealItem>
          ))}
        </ul>
      </div>
    </section>
  )
}
