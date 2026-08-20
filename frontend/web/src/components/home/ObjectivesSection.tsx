import { objectives } from './placeholders'

export function ObjectivesSection() {
  return (
    <section id={objectives.id} className="section" aria-labelledby="objectives-title">
      <div className="section-inner">
        <h2 id="objectives-title" className="section-title">{objectives.title}</h2>
        <p className="section-subtitle">{objectives.subtitle}</p>
        <ol className="objectives-list">
          {objectives.items.map((item) => (
            <li key={item.title} className="objective-item">
              <div className="objective-image-placeholder" role="img" aria-label={item.imageAlt}>
                <span className="placeholder-label">[Imagem]</span>
              </div>
              <h3 className="objective-title">{item.title}</h3>
              <p className="objective-description">{item.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
