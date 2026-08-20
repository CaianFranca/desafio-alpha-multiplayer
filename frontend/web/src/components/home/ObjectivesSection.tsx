import { objectives } from './placeholders'
import { ImagePlaceholder } from '../ui/ImagePlaceholder'

export function ObjectivesSection() {
  return (
    <section id={objectives.id} className="py-[clamp(3rem,8vh,6rem)] px-8" aria-labelledby="objectives-title">
      <div className="max-w-7xl mx-auto">
        <h2 id="objectives-title" className="text-[clamp(1.75rem,4vw,2.5rem)] text-center mb-2">{objectives.title}</h2>
        <p className="text-(--color-muted) text-center mb-8">{objectives.subtitle}</p>
        <ol className="list-none m-0 p-0 flex flex-col gap-8">
          {objectives.items.map((item) => (
            <li key={item.title}>
              <ImagePlaceholder alt={item.imageAlt} className="mb-4" />
              <h3 className="text-xl mb-2">{item.title}</h3>
              <p className="text-(--color-muted) text-sm leading-relaxed m-0">{item.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
