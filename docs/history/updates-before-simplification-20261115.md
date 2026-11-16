# Actual results

The runtime writes per-step state.json, saved output and check exit status under
.agents/factory/runs. It reports task completion through the canonical planner writer.
No four-group memory review, telemetry receipt or human approval blocks the loop.

Keep failures and partial work. Restart recovery reads the saved Codex thread before
continuing. Existing SQLite reports and imported sessions remain immutable history;
new factory output must never be passed off as a historical execution receipt.
