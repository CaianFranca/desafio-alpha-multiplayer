import { features } from './placeholders'
import { FeatureCard } from './FeatureCard'

export function FeaturesSection() {
  return (
    <section id={features.id} className="py-[clamp(3rem,8vh,6rem)] px-8 bg-(--color-surface)" aria-labelledby="features-title">
      <div className="max-w-7xl mx-auto">
        <h2 id="features-title" className="text-[clamp(1.75rem,4vw,2.5rem)] text-center mb-2">{features.title}</h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 list-none m-0 p-0" role="list">
          {features.items.map((item) => (
            <FeatureCard key={item.title} title={item.title} description={item.description} imageAlt={item.imageAlt} />
          ))}
        </ul>
      </div>
    </section>
  )
}
