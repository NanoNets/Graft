# bench/judge.ts · [[ai-model-evaluation]] [[benchmarking-framework]]

This file implements a correctness scoring system that evaluates AI-generated answers against a reference answer using keyword checks and an LLM judge.

- Verdict · interface · L18-L24 — The Verdict interface encapsulates the scoring results and correctness evaluation of an AI agent's answer.
- JudgeInput · interface · L26-L32 — The JudgeInput interface defines the structure of input data required for the judging process, including the question and answers.
- extractJson · function · L35-L49 — The extractJson function retrieves the first JSON object from a string, handling cases where the JSON is wrapped in additional text.
- judge · function · L51-L87 — The judge function evaluates an AI agent's answer against a reference answer, returning a Verdict based on keyword presence and LLM scoring.
