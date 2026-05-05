# Mobile UI Finalization Roadmap

This document is the source of truth for finishing the custom mobile UI work on
`custom/my-version`. It is intended to be used with Codex `/goal` so the
remaining work can be completed as a sequence of small, verified commits.

## Goal Prompt

Use this as the `/goal` text:

```text
Finish the ima2-gen mobile UI finalization on custom/my-version using docs/mobile-roadmap.md as the source of truth. Complete the remaining Prompt Library, Settings, Node secondary actions, Gallery polish, shared mobile UI cleanup, and final QA stages as small commits. After each implementation stage, run git diff --check, npm run build, npm test, and npm run test:mobile unless the stage is documentation-only. Preserve desktop UI, API behavior, DB/session schemas, and existing Node workflow features. Push successful commits to origin/custom/my-version.
```

## Current Status

The main mobile redesign is already implemented.

- Mobile Node has a dedicated workspace with `Node`, `All`, `Branches`, and `Map` views.
- `All` is now the primary node navigator with branch lanes, collapsible trees, search, status filter, current-node marker, and default-collapsed root lanes.
- `Branches` is a current-node control panel with parent/child cards, connection controls, branch creation, detach, and regenerate/cancel access.
- `Map` is a read-only workflow overview with SVG connectors, IMG line states, and fused CTX/SET badges.
- Connection Settings has compact delivery controls and preserves return-to-Node/Branches behavior.
- Classic mobile has a unified topbar, cleaner composer collapse, long-image-safe result layout, and primary/secondary result actions.
- Gallery has mobile sheet motion, thumbnail-backed loading, cursor pagination, server search/favorites for Date and Session views, stable order, scroll preservation, and invalid image filtering.
- Mobile overlays support backdrop close, browser/mobile back dismiss, and editor protection where needed.
- `npm run test:mobile` exists and covers the core mobile smoke flows.

## Definition Of Done

The mobile UI finalization is complete when:

- Android Chrome and iPhone Safari style viewports `390x844` and `430x932` are usable without hidden primary controls.
- Classic and Node share a coherent mobile visual language for topbars, sheets, panels, controls, and action hierarchy.
- Classic image generation, long-image review, result actions, Gallery, Settings, Prompt Library, and lightbox remain usable.
- Node workflows support selecting nodes, editing prompts/settings, generating/canceling, branching, branch regenerate/cancel, connection delivery, Gallery/Prompt Library access, and session switching.
- Desktop Classic and desktop Node remain visually and behaviorally stable.
- API, DB, history schema, and session graph schema are unchanged unless a later stage explicitly documents why a small server-side support change is required.
- `git diff --check`, `npm run build`, `npm test`, and `npm run test:mobile` pass before final push.
- The final branch is pushed to `origin/custom/my-version` with a clean worktree.

## Implementation Stages

### Stage 1: Prompt Library Mobile Polish

Purpose: make Prompt Library feel like the same mobile product family as Gallery and Settings, while preserving insert/replace/edit behavior.

Key work:

- Compact the mobile list/search/favorites layout so search, filters, and Add/Import actions do not compete for vertical space.
- Redesign prompt list items as compact touch cards with title, prompt preview, favorite marker, and clear insert/detail affordances.
- Polish mobile detail/editor states: keep `Back` for internal navigation, keep `Cancel`/`Save`, and make Insert/Replace/Delete/Favorite action hierarchy clearer.
- Preserve backdrop/mobile-back behavior and editor protection.
- Avoid changing prompt storage format or Prompt Library API behavior.

Verification:

- `npm run test:mobile` covers Prompt Library open, search, favorite/detail navigation, editor protection, and backdrop/mobile-back behavior.
- Manual check on `390x844` and `430x932`: list, detail, add/edit, save/cancel, insert/replace into Classic and selected Node.

Commit target:

- `Polish mobile prompt library`

### Stage 2: Settings Control Polish

Purpose: finish the mobile Settings surface so Classic and Node controls feel consistent.

Key work:

- Align Classic Settings control density with Node mobile controls: model, quality, size, format, provider, and advanced sections.
- Keep size/format visible and scrollable on first entry.
- Clarify section hierarchy without adding new settings or changing defaults.
- Keep Settings as a mobile sheet with backdrop/mobile-back close and no visible close/grab handle.
- Preserve desktop RightPanel behavior.

Verification:

- Classic Settings opens on `390x844` and `430x932` with model, quality, size, and format reachable.
- Node Settings entry points still open the selected-node settings area.
- `npm run test:mobile` verifies Settings open/close, scroll, size/format access, and topbar hit targets.

Commit target:

- `Polish mobile settings controls`

### Stage 3: Node Secondary Actions Cleanup

Purpose: make the selected Node edit screen clearer without changing graph behavior.

Key work:

- Review the selected Node screen for secondary actions that still feel visually heavy: attach/remove image, copy/download/export, API preview, delete, branch regenerate, and workflow actions.
- Keep prompt editing and generate/cancel as the primary flow.
- Keep Settings/API/Actions collapsed by default unless opened via the topbar Settings shortcut.
- Preserve all existing store actions and generation behavior.
- Do not redesign `All`, `Branches`, or `Map` unless a regression is found.

Verification:

- Ready, empty, stale, error, parented, root, pending, and image-attached nodes are checked in mobile smoke or manual Playwright flow.
- Generate/cancel, attach/remove, delete, branch regenerate/cancel, API preview, connection settings, and lightbox remain accessible.

Commit target:

- `Refine mobile node secondary actions`

### Stage 4: Gallery Session Polish And Asset Maintenance

Purpose: refine the now-stable Gallery backend/pagination work into a clearer user experience and safer maintenance story.

Key work:

- Improve Session view group headers: session label, item count, and empty/no-results states.
- Keep server-side Date/Session search and favorites pagination stable.
- Ensure favorite/delete/undo/import/lightbox behavior stays correct in Date and Session modes.
- Review cleanup script documentation and, if useful, add a short docs note for `npm run cleanup:invalid`.
- Do not add user-facing cleanup UI unless explicitly requested.

Verification:

- Date and Session Gallery both support search, favorites, Load more, delete/undo, favorite toggle, import, and lightbox.
- Invalid generated files stay hidden.
- `Load more` preserves order and scroll position.
- Thumbnail requests remain the primary tile image source.

Commit target:

- `Polish gallery sessions and cleanup docs`

### Stage 5: Shared Mobile UI Cleanup

Purpose: reduce drift between Classic and Node mobile surfaces after the design has stabilized.

Key work:

- Consolidate repeated mobile CSS tokens for surfaces, borders, radius, muted text, icon buttons, action rails, sheet bodies, and compact cards.
- Keep changes CSS-first unless a small helper component clearly removes real duplication.
- Avoid broad component rewrites and avoid desktop selector regressions.
- Keep `MobileToolbar`, `MobileNodeWorkspace`, Gallery, Prompt Library, and Settings visually aligned.

Verification:

- Side-by-side Playwright screenshots at `390x844` and `430x932` for Classic, Node, Gallery, Settings, Prompt Library, and lightbox.
- Desktop Classic and desktop Node smoke check for layout regressions.
- `npm run test:mobile` confirms topbar/sheet/tab hit targets.

Commit target:

- `Consolidate mobile UI styling`

### Stage 6: Final Regression Pass

Purpose: verify the whole mobile project end to end and prepare the branch for continued use.

Key work:

- Run full automated checks.
- Use Playwright/manual mobile checks for the highest-risk flows.
- Fix only concrete regressions found during final QA.
- Update this roadmap with final status if any scope changes were made.
- Commit and push final fixes.

Required automated checks:

- `git diff --check`
- `npm run build`
- `npm test`
- `npm run test:mobile`
- `npm run cleanup:invalid` dry-run

Manual/mobile scenarios:

- Classic: prompt open/collapse, generate/cancel, long vertical result, prompt summary, result actions, Gallery, Settings, Prompt Library, lightbox.
- Node: session switch, All search/filter/collapse, Node prompt/generate/cancel/settings/actions, Branches parent/child/connection/regenerate, Map overview/connector states, Connection Settings delivery toggles.
- Overlays: Gallery, Settings, Prompt Library, lightbox, and Node session sheet close via backdrop and browser/mobile back.
- Viewports: `390x844`, `430x932`, and at least one real Android Chrome or iPhone Safari check when available.

Commit target:

- `Finalize mobile UI regression pass`

## Out Of Scope Unless Requested

- Mobile freeform graph dragging or direct edge creation.
- Desktop Node redesign.
- New DB migrations or history/session schema changes.
- New generation API behavior.
- User-facing asset cleanup UI.
- Full server-side search for arbitrary future metadata beyond prompt and filename.
- Persisting every mobile UI preference to localStorage.

## Operating Rules For The Goal

- Work one stage at a time.
- Keep each stage small enough for one intentional commit.
- Prefer CSS and local component changes over new abstractions until duplication is stable and obvious.
- Do not add dependencies unless a task is impossible or meaningfully worse without one.
- Preserve user data and generated assets; cleanup commands must default to dry-run or move-to-trash behavior.
- After each successful implementation commit, push to `origin/custom/my-version`.
- If a stage reveals a new product decision, pause and record the options instead of silently expanding scope.

