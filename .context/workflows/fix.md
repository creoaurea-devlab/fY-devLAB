# Fix Workflow

Use for incorrect, regressed, or failing behavior.

1. Reproduce or directly inspect the failure before editing. Record the smallest
   observable symptom and its boundary.
2. Trace the cause through repository evidence; distinguish the root cause from
   downstream symptoms and unrelated defects.
3. Define the expected behavior and a focused regression check. If evidence is
   insufficient, stop with the missing evidence instead of guessing.
4. Apply the smallest complete fix inside the declared write set. Preserve
   unrelated behavior and public contracts unless the request changes them.
5. Run the regression check, then the nearest affected test or validation suite.
   Exercise an error path when the fix changes validation or failure handling.
6. Report cause, changed behavior, commands and results, residual risk, and any
   material context updates.
