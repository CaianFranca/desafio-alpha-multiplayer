import { HeroSection } from '../components/home/HeroSection'
import { HistorySection } from '../components/home/HistorySection'
import { FeaturesSection } from '../components/home/FeaturesSection'
import { ObjectivesSection } from '../components/home/ObjectivesSection'
import { FinalCtaSection } from '../components/home/FinalCtaSection'
import { Footer } from '../components/home/Footer'

export function HomePage() {
  return (
    <>
      <HeroSection />
      <HistorySection />
      <FeaturesSection />
      <ObjectivesSection />
      <FinalCtaSection />
      <Footer />
    </>
  )
}
