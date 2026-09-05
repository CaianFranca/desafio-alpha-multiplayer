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
      className={`${base} bg-surface border border-dashed border-muted ${className}`}
      role="img"
      aria-label={alt}
    >
      <span className="text-muted text-sm italic">[Imagem]</span>
    </div>
  )
}
