# test/context.test.ts

This file contains end-to-end tests for the markdown-graph pipeline to ensure proper functionality and integrity of the context building and checking processes.

- runCli · function · L19-L30 — function runCli(args: string[]): { stdout: string; stderr: string; status: number }
- makeFixture · function · L32-L43 — This function creates a temporary directory with mock service files for testing the context building process.
- buildOpts · function · L45-L47 — This function generates options for building the context, including a fake model and providers.
