# Product Charter: Full UX Retrofit

## Vision
Deliver a music-first Android experience with simple navigation, predictable playback behavior, and faster access to personal library content.

## Non-Negotiable Outcomes
- App opens into immediate music experience (no setup ritual UX).
- Navigation is always: Home, Search, Your Library, Create, Settings.
- Your Library defaults to All Songs every time it opens.
- Search supports global + scoped modes.
- Playback supports end-mode controls and random mode.
- Settings exposes theme controls at top.

## In-Scope
- Information architecture and page layout retrofit.
- Data model additions for play-history and popularity signals.
- Search API and UI behavior upgrades.
- Playback state-machine upgrades for modes.
- Runtime theme provider and persistence.

## Out-of-Scope (This Phase)
- Cloud sync/login/social features.
- Streaming integrations.
- Widget/notification redesign beyond required playback mode support.

## UX Principles
- Music first: primary actions should start playback or browsing quickly.
- Fewer dead ends: avoid CTA paths that do not lead to meaningful content.
- Predictable defaults: app remembers behavior and starts in useful views.
- Progressive disclosure: advanced tooling stays in settings/maintenance.

## Delivery Constraints
- Preserve existing playback reliability while refactoring.
- Ship in tight PR slices with frequent validation.
- Prioritize forward progress and rapid fixes over dual-path maintenance.
