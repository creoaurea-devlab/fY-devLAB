# Work loop

1. Read project memory and the applicable current plan item, then inspect current callers and the relevant ownership segment. Recheck affected facts against source.
2. Complete the mandatory boot preflight: checkout/outcome, owner, exact write scope,
   preserved resource owners and verification. Preserve unrelated work. Refresh the
   preflight when scope changes or context is restored.
3. Implement, then run proportional checks.
4. Review the lean invariants, update changed facts, decisions and the applicable plan
   using [update rules](updates.md). Report actual results, unfinished work and limitations.

Do not use disconnected planner/executor commands or infer current authority from historical receipts.
