import { HeroSection } from '../components/home/HeroSection'
import { TrailersSection } from '../components/home/TrailersSection'
import { HistorySection } from '../components/home/HistorySection'
import { FeaturesSection } from '../components/home/FeaturesSection'
import { ObjectivesSection } from '../components/home/ObjectivesSection'
import { FinalCtaSection } from '../components/home/FinalCtaSection'
import { Footer } from '../components/home/Footer'

export function HomePage() {
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
