# Planning Workflow

Use to produce an evidence-based implementation or delivery plan.

1. Define the outcome, constraints, acceptance criteria, and decisions still
   owned by the user.
2. Inspect the smallest repository surfaces needed to identify current behavior,
   module boundaries, dependencies, commands, and risks.
3. Separate verified facts, explicit assumptions, and unresolved questions.
   Resolve locally discoverable questions before presenting the plan.
4. Break work into ordered, independently verifiable steps. Name affected paths,
   dependencies, rollback points, and verification for each step.
5. Record only authorized planning artifacts in the declared write set. Do not
   mutate product code, services, data, or configuration under a planning task.
6. Finish with risks, decision points, completion criteria, and the first safe
   executable step.

The plan must link goal → milestone → slice → atomic task with acyclic dependencies, exact candidate files, checks and acceptance IDs. JSON is the execution authority; Markdown explains decisions and rollback. Validate all references before dispatching workers.
