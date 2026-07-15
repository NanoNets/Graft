---
name: Task Management
slug: task-management
type: system
sources:
  - path: bench/tasks.ts
    hash: d21168797f40d193a914aca0c438409d29d300441bc0a6a518c93869240b3b69
sources_digest: 2940a72050e0bee89a860d904a1ebf289505f797cd93c71d86c2e776227e3fb4
links:
  - to: benchmarking-framework
    relation: part_of
    description: It provides the tasks that the benchmarking framework evaluates.
generator:
  version: 1
covers:
  - symbol: repoPath
    kind: function
    at: 'bench/tasks.ts:L26-L29'
  - symbol: Task
    kind: interface
    at: 'bench/tasks.ts:L31-L37'
  - symbol: Corpus
    kind: interface
    at: 'bench/tasks.ts:L39-L45'
---
<!-- context:generated:start -->
## Summary

This component defines the benchmark tasks and corpora used for evaluation, ensuring that each task has a verifiable answer based on actual source code. It emphasizes fair assessments of code comprehension across various tasks.

## Related

- part of [[benchmarking-framework]] — It provides the tasks that the benchmarking framework evaluates.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
