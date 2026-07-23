# bench/judge.ts · [[benchmarking-system]] [[judge]]

This file implements a correctness scoring system that evaluates AI-generated answers against a reference answer, ensuring both keyword requirements and factual accuracy are met.

- Verdict · interface · L18-L24 — The Verdict interface encapsulates the scoring results and correctness evaluation of an AI agent's answer.
- JudgeInput · interface · L26-L32 — Defines the structure for input data required to evaluate an AI agent's answer, including the question, reference answer, and required keywords.
- extractJson · function · L35-L49 — The extractJson function retrieves the first JSON object from a string, handling cases where the JSON is wrapped in additional text.
- judge · function · L51-L86 — Evaluates an AI agent's answer against a reference answer, returning a verdict that indicates correctness based on both a judge's score and keyword requirements.
