# Milestone and slice disclosures

Extend the current UI delivery with compact milestones that toggle open, slices that
summarize actual atomic tasks as static glowing status dashes, and an inline task view
opened by pressing the slice summary. Apply the interaction to Structure and Kanban.

Use Matt Pocock's codebase-design guidance: keep behavior behind the existing planning-ui
interface. One private slice renderer owns disclosure, task-status semantics and drop
handling in both views. Canonical task definitions and reported progress retain their
existing writer/contracts. Forms and workspace resource owners remain outside disclosure.

Milestones start collapsed. Native buttons expose expanded state and stable target IDs.
Slice dashes follow sliceTasks saved order, use statusOf/STATUS_LABELS and include textual
status totals. Static glow distinguishes current reported statuses without animation.
Empty slices remain navigable. Read-only previews allow browsing but retain mutation
restrictions. Filters reveal matches once per changed intent; manual collapse survives
polling and clearing filters preserves the current exploration state. Project changes
reset local disclosure; same-project polling and compatible refresh retain it.

Acceptance: Enter/Space toggles, visible-task order/status, four status labels, long wrapped
slice summaries, empty slices, filter/manual-collapse semantics, edit/drop separation,
read-only behavior, both responsive sizes and retained editor/preview/terminal owners.
Task and progress JSON must be unchanged by disclosure actions. Actual GUI mutation tests
use private projects. Keep the previous WISDOHM controls/memory work and pending live
backend activation decision intact. No Git or source-release changes.
