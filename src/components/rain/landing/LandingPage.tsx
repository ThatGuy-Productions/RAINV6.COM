'use client'

import { MotionConfig } from 'framer-motion'
import { LandingNav } from './LandingNav'
import { PartnerLogos } from './PartnerLogos'
import { LandingHero } from './LandingHero'
import { LandingDemo } from './LandingDemo'
import { LandingBetaVelocity } from './LandingBetaVelocity'
import { LandingFeatures } from './LandingFeatures'
import { LandingTestimonials } from './LandingTestimonials'
import { LandingArchitecture } from './LandingArchitecture'
import { LandingCompliance } from './LandingCompliance'
import { LandingReviews } from './LandingReviews'
import { LandingPricing } from './LandingPricing'
import { LandingFAQ } from './LandingFAQ'
import { LandingFooter } from './LandingFooter'

interface LandingPageProps {
  onLaunch: () => void
}

export function LandingPage({ onLaunch }: LandingPageProps) {
  // MotionConfig initial={false} disables framer-motion's mount-time `initial`
  // style injection across the entire landing page. This prevents SSR/client
  // hydration mismatches (motion renders `style="opacity:0;..."` on the server
  // but the client immediately animates, causing React hydration warnings that
  // blocked the dev overlay). CSS animations (rain-float, rain-pulse, etc.)
  // and `animate`/`whileInView` props still work — only the `initial` entrance
  // snapshot is skipped.
  return (
    <MotionConfig initial={false}>
      <div className="min-h-screen flex flex-col">
        <LandingNav onLaunch={onLaunch} />
        {/* Partner logo marquee banner — horizontal strip just below the main nav */}
        <PartnerLogos />
        <main className="flex-1">
          <LandingHero onLaunch={onLaunch} />
          <LandingDemo onLaunch={onLaunch} />
          <LandingBetaVelocity />
          <LandingFeatures />
          <LandingTestimonials />
          <LandingArchitecture />
          <LandingCompliance />
          <LandingReviews />
          <LandingPricing onLaunch={onLaunch} />
          <LandingFAQ />
        </main>
        <LandingFooter />
      </div>
    </MotionConfig>
  )
}
