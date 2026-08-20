import { features } from './placeholders'

export function FeaturesSection() {
  return (
    <section id={features.id} className="section section-alt" aria-labelledby="features-title">
      <div className="section-inner">
        <h2 id="features-title" className="section-title">{features.title}</h2>
        <ul className="features-grid" role="list">
          {features.items.map((item) => (
            <li key={item.title} className="feature-card">
              <div className="feature-image-placeholder" role="img" aria-label={item.imageAlt}>
                <span className="placeholder-label">[Imagem]</span>
              </div>
              <h3 className="feature-title">{item.title}</h3>
              <p className="feature-description">{item.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
