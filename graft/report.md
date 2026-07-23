---
name: Report
slug: report
type: system
sources:
  - path: bench/report.ts
    hash: 17c0be550f9712165177d070f58cbe7a0f60fcb2c1dc5830eb1a4dde97ec12f3
sources_digest: 38642e3446c662002dd4ca9bd1c6438520ecfe224cb0b2481b1c21d74dc32228
links:
  - to: benchmarking-system
    relation: part_of
    description: The report is a key output of the benchmarking system.
generator:
  version: 1
covers:
  - symbol: Arm
    kind: type
    at: 'bench/report.ts:L6-L6'
  - symbol: Row
    kind: interface
    at: 'bench/report.ts:L8-L30'
  - symbol: costOf
    kind: function
    at: 'bench/report.ts:L37-L42'
  - symbol: mean
    kind: function
    at: 'bench/report.ts:L44-L46'
  - symbol: ArmAgg
    kind: interface
    at: 'bench/report.ts:L48-L58'
  - symbol: aggregate
    kind: function
    at: 'bench/report.ts:L60-L72'
  - symbol: pctDelta
    kind: function
    at: 'bench/report.ts:L74-L78'
  - symbol: fmt
    kind: function
    at: 'bench/report.ts:L80-L82'
  - symbol: metricTable
    kind: function
    at: 'bench/report.ts:L88-L114'
  - symbol: cells
    kind: function
    at: 'bench/report.ts:L93-L102'
  - symbol: verdictFor
    kind: function
    at: 'bench/report.ts:L117-L127'
  - symbol: buildMarkdown
    kind: function
    at: 'bench/report.ts:L129-L175'
---
<!-- context:generated:start -->
## Summary

The report component aggregates benchmarking results from various trials, transforming raw data into a structured markdown report that highlights performance metrics and provides insights into the benchmarking context.

## Related

- part of [[benchmarking-system]] — The report is a key output of the benchmarking system.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
