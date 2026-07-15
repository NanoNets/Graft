# src/ingest/fs.ts

This file provides utilities for walking through a filesystem to identify source files while excluding certain directories and large files.

- walkDir · function · L27-L45 — The walkDir function recursively collects paths of files in a directory while skipping specified directories and files larger than 1 MB.
