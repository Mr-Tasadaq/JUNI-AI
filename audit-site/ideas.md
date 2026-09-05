# Design directions

## Approach 1
- **Theme Name:** Evidence Ledger
- **Very Brief Intro:** A premium editorial audit interface that treats the service-layer report like a field manual: warm paper, ink-black panels, signal orange, and careful typographic hierarchy. It feels rigorous, human, and built for review.
- **Probability:** 0.07

## Approach 2
- **Theme Name:** Systems Observatory
- **Very Brief Intro:** A cool, dark observatory interface with electric blue instrumentation, live-looking telemetry, and a technical control-room mood. It makes architecture feel measurable and operational.
- **Probability:** 0.04

## Approach 3
- **Theme Name:** Quiet Atlas
- **Very Brief Intro:** A light, restrained cartographic report with muted sage, cream, and graphite. The experience would feel calm, navigable, and archival, with the audit mapped like a set of connected territories.
- **Probability:** 0.03

# Chosen approach: Evidence Ledger

## Design Movement
Contemporary editorial brutalism, softened by archival paper textures and a restrained systems aesthetic.

## Core Principles
1. **Evidence before decoration:** Every visual flourish must clarify scope, ownership, or risk.
2. **Tension between paper and instrument:** Warm off-white surfaces carry the narrative; black and orange panels signal system states and findings.
3. **Asymmetric reading rhythm:** The layout should feel like a dossier with a persistent rail, offset cards, and varied section widths—not a centered marketing grid.
4. **Compact signal language:** Small labels, rule lines, chips, and monospace metadata make technical detail scannable without flattening it.

## Color Philosophy
Warm paper (#F3EFE7) creates the feel of a report meant to be printed and marked up. Ink-black (#151719) is reserved for the executive readout, deep findings, and navigation. Signal orange (#E85C2A) marks attention, boundaries, and decisions; muted olive and steel-blue are secondary cues for classification and operational status. The palette is intentionally non-neon: serious, tactile, and legible.

## Layout Paradigm
Persistent left rail on desktop with a document canvas to the right. The hero opens as a split dossier cover; key numbers appear as a vertical evidence strip; sections alternate between wide narrative passages and compact diagnostic tables. On mobile, the rail becomes a sticky top bar and sections become stacked cards.

## Signature Elements
- A large orange index mark “09” paired with a thin ruled label system.
- Ink-black “evidence” panels with orange edge markers and monospace metadata.
- A service-boundary map rendered as a horizontal chain of nodes and directional rules.

## Interaction Philosophy
Interactions should feel like turning pages or focusing a lens: clicking a section updates the active rail marker, finding cards expand inline, and the service map highlights the selected layer. Hover states use small translations, underline sweeps, and color inversion rather than bouncing or glow.

## Animation
Use 180–260ms ease-out transitions for rail links, cards, and map nodes. Initial content reveals in a 40ms staggered sequence. Avoid continuous motion. Respect reduced-motion preferences. Use transform and opacity only.

## Typography System
- **Display:** Fraunces, 700–800, for report title and major section headings.
- **Body:** DM Sans, 400–600, for readable narrative and table copy.
- **Metadata:** IBM Plex Mono, 500–600, uppercase and letter-spaced for labels, route names, and counts.
Hierarchy is created with scale, weight, and rule lines rather than excessive color variation.

## Brand Essence
A visual operating brief for understanding JUNI-AI’s real service boundaries—built for engineers, reviewers, and security-minded product owners. **Precise. Candid. Navigable.**

## Brand Voice
Headlines are direct and specific. CTAs are verbs with an audit posture. Microcopy states what exists, what is coupled, and what is intentionally absent.

Example lines:
- “The active domain is smaller than the repository suggests.”
- “Trace the boundary before you add the service.”

## Wordmark & Logo
A custom “JL/09” monogram: two offset vertical rules create an abstract J and L, with a small orange index square. It should appear as a compact mark, not a text wordmark.

## Signature Brand Color
Signal orange `#E85C2A`.

## Style Decisions
- The JL/09 monogram and a large “09” index mark are visible above the fold as persistent audit anchors.
- Signal orange `#E85C2A` is semantic: it marks active indices, boundaries, severity, and primary audit actions.
- Every major section carries at least one ledger cue: evidence ID, ruled metadata, classification tag, or edge marker.
- Later sections use offset headings and evidence strips to preserve the dossier rhythm instead of reverting to generic card layouts.
