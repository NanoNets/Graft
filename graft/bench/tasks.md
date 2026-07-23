# bench/tasks.ts · [[benchmarking-system]] [[tasks]]

This file defines benchmark tasks and their associated metadata to ensure verifiable answers for codebase questions.

- repoPath · function · L30-L33 — This function determines the file path for sibling repositories, allowing for environment variable overrides.
- Task · interface · L35-L45 — The Task interface structures the data for individual benchmark questions, ensuring they include necessary details for validation.
- Corpus · interface · L47-L53 — This interface defines a corpus of benchmark tasks, specifying its ID, type, path, and associated tasks.
