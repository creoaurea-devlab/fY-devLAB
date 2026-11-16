# S — Single Responsibility Principle

Read when deciding what belongs in a module, function, or class, or when unrelated changes repeatedly collide.

Martin explains responsibility through the people or business function requesting change: keep together behavior that changes for the same reason and separate behavior driven by different concerns. [Primary explanation](https://blog.cleancoder.com/uncle-bob/2014/05/08/SingleReponsibilityPrinciple.html).

## Agent rules — local application

1. Name the capability and the stakeholder or policy that drives its changes. An actor is a business role or cohesive group, not the agent assigned to a file.
2. Separate independently changing policy, presentation, and persistence when their coupling makes a concrete change risky.
3. Keep the related steps and helpers of one responsibility together. Method count, file length, and agent count do not define responsibility.
4. Extract only enough to isolate the identified reason for change; keep the public boundary small.

## Example and review evidence

An invoice calculation should not require editing HTML rendering when tax policy changes. Separate those concerns if they are coupled; the calculation may still contain several related operations.

Identify whose request caused the change and which unrelated behavior it could affect. Confirm the changed policy and any previously coupled consumer still behave correctly.
