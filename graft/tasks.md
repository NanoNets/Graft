---
name: Tasks
slug: tasks
type: system
sources:
  - path: bench/tasks.ts
    hash: efb90e69f52adcb08bfe45fb5a983fc676df68befdc455513e2581a24f46807e
sources_digest: bf5418660cc917f7af4f93b7ed71cfc4c37f06a27af5b61047b54ba572a3a2b0
links:
  - to: agent
    relation: depends_on
    description: The agent executes the tasks defined in this component.
generator:
  version: 1
covers:
  - symbol: repoPath
    kind: function
    at: 'bench/tasks.ts:L30-L33'
  - symbol: Task
    kind: interface
    at: 'bench/tasks.ts:L35-L45'
  - symbol: Corpus
    kind: interface
    at: 'bench/tasks.ts:L47-L53'
---
<!-- context:generated:start -->
## Summary

The tasks component defines a set of benchmark questions and expected answers, ensuring that each task is verifiable based on actual source code. It facilitates the evaluation of code understanding and comprehension.

## Related

- depends on [[agent]] — The agent executes the tasks defined in this component.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
