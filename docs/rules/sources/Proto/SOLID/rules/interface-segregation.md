# I — Interface Segregation Principle

Read when a shared API exposes unrelated capabilities or a consumer is affected by methods it does not use.

Martin's ISP separates cohesive interfaces around different clients' needs so unrelated interface changes do not impose dependencies on those clients. A single implementation may expose several such interfaces. [Original paper](https://objectmentor.com/resources/articles/isp.pdf).

## Agent rules — local application

1. Identify the consumers and the operations each needs. Design the consumed contract around that use, rather than copying the entire implementation surface.
2. Separate capability groups when their consumers or reasons for change differ. Keep related operations together even when that means several methods.
3. Allow one implementation to satisfy multiple focused contracts. Splitting interfaces does not automatically require splitting the implementation.
4. Use an existing narrow type or view when sufficient. Introduce separately named interfaces only when they express a meaningful boundary.
5. Treat mandatory no-op or unsupported methods as evidence that the advertised capability needs review.

## Example and review evidence

A run-history screen may need `RunReader`, while an executor needs writing capabilities. The same store can provide both without giving the screen a dependency on writes.

Confirm each consumer can use and test its required capability without implementing unrelated methods. Method count alone is not an interface-quality metric.
