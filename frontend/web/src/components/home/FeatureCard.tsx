import { ImagePlaceholder } from '../ui/ImagePlaceholder'

interface FeatureCardProps {
  title: string
  description: string
  imageAlt: string
}

export function FeatureCard({ title, description, imageAlt }: FeatureCardProps) {
  return (
    <div className="features-card">
      <span aria-hidden="true" className="features-badge" />
      <ImagePlaceholder alt={imageAlt} className="features-media" />
      <h3 className="text-xl mt-4 mb-2">{title}</h3>
      <p className="text-(--color-muted) text-sm leading-relaxed m-0">{description}</p>
    </div>
  )
}
