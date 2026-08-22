import { history } from './placeholders'
import { ImagePlaceholder } from '../ui/ImagePlaceholder'

export function HistorySection() {
  return (
    <section id={history.id} className="py-[clamp(3rem,8vh,6rem)] px-8" aria-labelledby="history-title">
      <div className="max-w-7xl mx-auto">
        <h2 id="history-title" className="text-[clamp(1.75rem,4vw,2.5rem)] text-center mb-2">{history.title}</h2>
        <div className="flex flex-col gap-8 items-center md:flex-row md:gap-12">
          <div className="md:w-3/5">
            {history.paragraphs.map((p, i) => (
              <p key={i} className="text-(--color-muted) leading-7 mb-4">{p}</p>
            ))}
          </div>
          <ImagePlaceholder alt={history.imageAlt} className="md:w-2/5" />
        </div>
      </div>
    </section>
  )
}
