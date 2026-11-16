# Ownership

Keep three separate facts:

- **Assignment:** each terminal node saves its owner and mode. A running shell keeps the policy it started with. Missing saved settings recover from that shell; explicit settings apply to the next shell.
- **File scope:** each `<group>/<capability>.yaml` names one capability and its exact paths. Read only the relevant segment. Groups are navigation, not broader write permissions.
- **Enforcement:** Off uses normal local access; Guided shows an advisory scope; Strict confines writes and blocks network access. Changing a selection does not change a running process’s access.

Preserve unrelated files and live terminal/editor/preview owners. Verify the behavior affected by a change; report real evidence. Historical plans and SQL reports do not grant permission or prove current execution. Planning and executor sources remain disconnected in `../devLAB-planning-runtime-standalone/` relative to the repository root.
