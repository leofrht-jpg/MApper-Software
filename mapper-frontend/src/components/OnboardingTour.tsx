/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { useEffect, useState } from 'react'
import { Joyride, STATUS, type EventData, type Step } from 'react-joyride'

const STORAGE_KEY = 'mapper-onboarding-complete'

// Workflow-driven tour: walks through one representative research question
// end-to-end ("climate impact of a product archetype, base ecoinvent, with
// end-of-life included") rather than describing each tab in isolation. The
// goal is to teach what MApper *does*, not enumerate features. New tabs or
// features should not automatically gain tour steps — the tour stays
// focused on the canonical research workflow.
export const STEPS: Step[] = [
  {
    target: 'body',
    title: 'Welcome to MApper',
    content:
      'MApper integrates four methodologies into one workflow: LCA, dynamic stock modelling, prospective LCA, and absolute environmental sustainability assessment. This 2-minute tour walks through computing a product\'s climate impact end-to-end, hitting each stage of the pipeline in research order.',
    placement: 'center',
    skipBeacon: true,
  },
  {
    target: '[data-tour="nav-databases"]',
    title: '1. The data foundation',
    content:
      'Every assessment starts from a Brightway2 project. Database Explorer shows what\'s loaded: base ecoinvent for static analysis, plus any prospective (future-scenario) databases generated via the pLCA Developer tab. For this tour we\'ll use the static base; nothing to configure here.',
    placement: 'right',
    skipBeacon: true,
  },
  {
    target: '[data-tour="nav-lca"]',
    title: '2. Define the product',
    content:
      'Archetypes are MApper\'s primary unit of analysis: a structured Bill of Materials linked to ecoinvent activities, organised by lifecycle stage (Manufacturing, Use Phase, Maintenance, End of Life). Open an archetype here to inspect its BOM, link materials, and run a single-product LCA before scaling up.',
    placement: 'right',
    skipBeacon: true,
  },
  {
    target: '[data-tour="nav-dsm"]',
    title: '3. Scale to a fleet over time',
    content:
      'A single-product impact tells you per-unit. To get the system view, the Dynamic Stock Modeller tracks how products enter and leave the population year by year: every cohort, from birth to deregistration, with Weibull survival. DSM scenarios are independent slots; you can run impacts against several to compare stock futures.',
    placement: 'right',
    skipBeacon: true,
  },
  {
    target: '[data-tour="nav-impact"]',
    title: '4. Compute the impact',
    content:
      'Pick an LCIA method (EF v3.1 by default), choose lifecycle stages, click Calculate. Static Background uses today\'s ecoinvent; Prospective Background year-matches each cohort to a future-scenario database. You can fan out across three axes to compare scenarios in one run: LCI source, DSM scenario, or parameter sensitivity.',
    placement: 'right',
    skipBeacon: true,
  },
  {
    target: '[data-tour="nav-aesa"]',
    title: '5. Compare against planetary boundaries',
    content:
      'AESA is what makes MApper distinct from other LCA tools. It downscales planetary boundaries to your system using category-specific sharing principles, and reports a Sustainability Ratio (SR) per indicator. SR ≤ 1 means within Earth\'s safe operating space; SR > 1 means the system exceeds its fair share of the budget.',
    placement: 'right',
    skipBeacon: true,
  },
  {
    target: '[data-tour="nav-uncertainty"]',
    title: '6. Put error bars on it',
    content:
      'Monte Carlo uncertainty propagation for a single-product assessment. Reach it from the "Run uncertainty" button on a Single-product result, which carries that archetype, its indicators and scope across, or open the tab directly. Unscored, a run varies the background only: ecoinvent\'s own exchange uncertainty. Foreground uncertainty needs your materials and parameters scored, in the Material scoring section here.',
    placement: 'right',
    skipBeacon: true,
  },
  {
    target: 'body',
    title: 'That\'s the workflow',
    content:
      'You\'ve seen one static computation end-to-end. From here: explore prospective LCA for year-matched future scenarios, multi-scenario fan-out for sensitivity analysis, and contribution trees for diagnosing where impacts come from. Settings (gear icon) holds theming, log export, and a "Restart tour" button to revisit this any time.',
    placement: 'center',
    skipBeacon: true,
  },
]

export function hasCompletedOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return true // be conservative on storage errors; don't spam the tour
  }
}

export function markOnboardingComplete() {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // ignore
  }
}

export function resetOnboarding() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

interface Props {
  run: boolean
  onFinish: () => void
}

export function OnboardingTour({ run, onFinish }: Props) {
  // Joyride can't find its targets before they mount. Delay one frame once
  // ``run`` flips on so the sidebar is guaranteed to be in the DOM.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!run) { setReady(false); return }
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [run])

  const handleEvent = (data: EventData) => {
    const { status } = data
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      markOnboardingComplete()
      onFinish()
    }
  }

  // ESCAPE IS THE ESCAPE HATCH, and it has to live here rather than in
  // Joyride's own key handling.
  //
  // The overlay is a 65%-opaque black sheet over the whole viewport at
  // z-index 10000, and `overlayClickAction: false` / `dismissKeyAction: false`
  // deliberately block dismissal so a stray click cannot skip the tour. That is
  // fine while a tooltip is on screen -- "Skip tour" is right there. It is not
  // fine when there is no tooltip: Joyride silently drops a step whose target
  // is missing, and the result is a near-black app with no visible control and
  // no way out, which reads as a hung window rather than a tour.
  //
  // So: keep the click/key guards (no accidental dismissal), and add ONE
  // deliberate exit. Escape ends the tour the same way "Skip tour" does --
  // through `markOnboardingComplete()` + `onFinish()`, so a tour escaped this
  // way does not re-arm on the next launch.
  useEffect(() => {
    if (!run) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      markOnboardingComplete()
      onFinish()
    }
    // Capture phase: the overlay sits above everything, and nothing else in the
    // app should be able to swallow the one key that gets the user out.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [run, onFinish])

  if (!ready) return null

  return (
    <Joyride
      steps={STEPS}
      run={run}
      continuous
      scrollToFirstStep={false}
      onEvent={handleEvent}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Get started',
        next: 'Next',
        skip: 'Skip tour',
      }}
      options={{
        // No 'close' → no ✕; include 'skip' so every step is dismissable.
        buttons: ['back', 'primary', 'skip'],
        // Block accidental dismiss via backdrop or keyboard.
        overlayClickAction: false,
        dismissKeyAction: false,
        overlayColor: 'rgba(0, 0, 0, 0.65)',
        primaryColor: '#14b8a6',
        arrowColor: '#161b22',
        backgroundColor: '#161b22',
        textColor: '#e6edf3',
        spotlightPadding: 4,
        spotlightRadius: 6,
        zIndex: 10000,
      }}
      styles={{
        tooltip: {
          backgroundColor: '#161b22',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          padding: 20,
          color: '#e6edf3',
          fontSize: 14,
          lineHeight: 1.5,
          maxWidth: 380,
        },
        tooltipTitle: {
          color: '#e6edf3',
          fontSize: 16,
          fontWeight: 600,
          margin: 0,
          textAlign: 'left',
        },
        tooltipContent: {
          color: '#c9d1d9',
          fontSize: 13,
          lineHeight: 1.55,
          padding: '10px 0 0 0',
          textAlign: 'left',
        },
        tooltipFooter: {
          marginTop: 16,
        },
        buttonPrimary: {
          backgroundColor: '#14b8a6',
          color: '#0b0f14',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
          padding: '6px 14px',
        },
        buttonBack: {
          color: '#c9d1d9',
          fontSize: 13,
          marginRight: 8,
        },
        buttonSkip: {
          color: '#8b949e',
          fontSize: 13,
        },
        spotlight: {
          stroke: '#14b8a6',
          strokeWidth: 2,
        },
      }}
    />
  )
}
