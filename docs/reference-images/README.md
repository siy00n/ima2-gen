# Reference Images: Mobile Node Workspace

This folder contains implementation reference images for a future mobile-only Node UI in `ima2-gen`.

These images are not final production screenshots. They define layout, density, interaction priorities, and visual direction. Generated text inside images is placeholder reference and should not be copied literally into implementation.

## Files

- `01-mobile-node-focus.png`: focused selected-node editor
- `02-mobile-node-branches.png`: branch and lineage management
- `03-mobile-node-map.png`: simplified graph map overview
- `04-mobile-node-connection-settings.png`: parent edge IMG/CTX/SET settings
- `05-mobile-node-empty-start.png`: empty start and no-selection state
- `style-brief.md`: shared visual and interaction direction
- `prompt-set.md`: reference profiles and prompts
- `review-ledger.md`: pass scores and audit notes

## Implementation Guidance

- Keep desktop `NodeCanvas` intact.
- Build mobile Node mode as a separate focused workspace.
- Use the same store/API/schema where possible.
- Treat graph editing as explicit actions on mobile: add child, add sibling, branch regenerate, detach, and edit connection settings.
