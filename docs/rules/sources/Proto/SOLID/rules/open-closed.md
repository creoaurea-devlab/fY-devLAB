# O — Open/Closed Principle

Read when adding a variant or deciding whether an extension point is justified.

OCP seeks extension without modifying protected behavior. Martin clarifies that closure is strategic, against selected kinds of change; significant systems cannot be closed against every change. [Author's clarification](https://blog.cleancoder.com/uncle-bob/2013/03/08/AnOpenAndClosedCase.html).

## Agent rules — local application

1. Identify the concrete variation to support and the existing behavior that should remain stable.
2. Use an established extension point first. Introduce one when the current requirement demonstrates a useful boundary.
3. Add the new variant behind that boundary; keep selection and registration in composition where appropriate.
4. Edit existing code when fixing a defect, changing requirements, or improving an unsuitable boundary. Review the affected consumers explicitly.
5. Prefer a simple branch or direct implementation when a general mechanism would add more complexity than the present variation warrants.

## Example and review evidence

Add another model provider through the existing provider contract. Composition may change to select it; unrelated workflow policy should not need provider-specific branches.

Demonstrate the new variant and the preserved behavior. An extension framework without a present use case is not evidence of a better design.
