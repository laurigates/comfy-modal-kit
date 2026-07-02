# Architecture Decision Records (ADRs)

Architecture Decision Records for **@laurigates/comfy-modal-kit** in the
[MADR](https://adr.github.io/madr/) format. An ADR captures a significant
architectural decision, its context, the options considered, and the rationale.
ADRs are immutable — when a decision changes, a new ADR supersedes the old one
rather than editing it.

This is a **minimal blueprint** (ADR index only): the kit is a
release-please-managed npm package, not a full blueprint project, so there is
no `manifest.json` / `feature-tracker.json` / PRD here — YAGNI.

## Current ADRs

| ID | Title | Status | Domain |
|----|-------|--------|--------|
| ADR-0001 | Cross-Pack Field-Provider Registry & Click Coordination | Accepted | api-design |

## Status Definitions

| Status | Meaning |
|--------|---------|
| **Proposed** | Under discussion, not yet decided |
| **Accepted** | Decision in effect |
| **Deprecated** | No longer relevant but not replaced |
| **Superseded** | Replaced by a newer ADR (linked via `supersedes` / a top note) |

## How to Add an ADR

1. Pick the next sequential number (`0002`, `0003`, …).
2. Copy the frontmatter + section layout from `0001-*.md`.
3. Fill in the frontmatter (`id`, `date`, `status`, `domain`, `relates-to`,
   `github-issues`).
4. Document Decision Drivers → Considered Options → Decision Outcome
   (+ Positive/Negative Consequences) → Pros and Cons → Links.
5. Update this README's index table.
6. If it supersedes an existing ADR, set the old ADR's `status` to `Superseded`
   and add a top note pointing to the new one.
