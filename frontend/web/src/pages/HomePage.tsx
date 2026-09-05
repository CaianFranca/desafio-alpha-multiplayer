import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { HeroSection } from '../components/home/HeroSection'
import { TrailersSection } from '../components/home/TrailersSection'
import { HistorySection } from '../components/home/HistorySection'
import { FeaturesSection } from '../components/home/FeaturesSection'
import { ObjectivesSection } from '../components/home/ObjectivesSection'
import { FinalCtaSection } from '../components/home/FinalCtaSection'
import { Footer } from '../components/home/Footer'

export function HomePage() {
  const { hash } = useLocation()

  // Chegando via "/#secao" (nav do header fora da Home ou link externo),
  // posiciona de forma instantânea — sem smooth fora da Home.
  useEffect(() => {
    if (!hash) return
    document.getElementById(hash.slice(1))?.scrollIntoView?.({ behavior: 'auto', block: 'start' })
  }, [hash])
  return (
    <div className="foundation-scope">
      <HeroSection />
      <TrailersSection />
      <HistorySection />
      <FeaturesSection />
      <ObjectivesSection />
      <FinalCtaSection />
      <Footer />
    </div>
  )
}
