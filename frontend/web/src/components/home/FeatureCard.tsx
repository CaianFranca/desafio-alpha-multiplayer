import { ImagePlaceholder } from '../ui/ImagePlaceholder'

interface FeatureCardProps {
  title: string
  description: string
  imageAlt: string
}

export function FeatureCard({ title, description, imageAlt }: FeatureCardProps) {
  return (
    <li className="bg-(--color-background) rounded-xl p-6">
      <ImagePlaceholder alt={imageAlt} />
      <h3 className="text-xl mt-4 mb-2">{title}</h3>
      <p className="text-(--color-muted) text-sm leading-relaxed m-0">{description}</p>
    </li>
  )
}
