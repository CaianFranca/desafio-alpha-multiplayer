import { history } from './placeholders'

export function HistorySection() {
  return (
    <section id={history.id} className="section" aria-labelledby="history-title">
      <div className="section-inner">
        <h2 id="history-title" className="section-title">{history.title}</h2>
        <div className="section-content">
          <div className="section-text">
            {history.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <div className="section-image-placeholder" role="img" aria-label={history.imageAlt}>
            <span className="placeholder-label">[Imagem]</span>
          </div>
        </div>
      </div>
    </section>
  )
}
