#!/usr/bin/env node
const path = require('path');
const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
import(path.join(dir, 'dist', 'claude', 'hooks.js'))
  .then((m) => m.main(process.argv[2]))
  .catch(() => { /* best-effort: never disrupt the session */ });
