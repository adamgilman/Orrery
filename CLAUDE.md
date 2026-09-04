# Orrery

Animated, navigable architecture diagrams from JSON, built for AI agents to author. See PRD.md.

- TDD is mandatory: failing test first. `yarn test` (builds, then tests everything).
- Use Yarn. Node 22+.
- Working on the tool itself: load the `orrery-dev` skill (.claude/skills/orrery-dev/SKILL.md) for the render → inspect → look loop.
- `yarn inspect <file>` renders, freezes animation frames to PNG, checks timing, and writes a contact sheet to look at.
