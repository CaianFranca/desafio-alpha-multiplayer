interface ImagePlaceholderProps {
  alt: string
  src?: string
  className?: string
}

export function ImagePlaceholder({ alt, src, className = '' }: ImagePlaceholderProps) {
  const base = 'flex items-center justify-center w-full aspect-video rounded-xl overflow-hidden'

  if (src) {
    return (
      <img src={src} alt={alt} className={`${base} object-cover ${className}`} />
    )
  }

  return (
    <div
      className={`${base} bg-(--color-surface) border border-dashed border-(--color-muted) ${className}`}
      role="img"
      aria-label={alt}
    >
      <span className="text-(--color-muted) text-sm italic">[Imagem]</span>
    </div>
  )
}
