#!/usr/bin/env node
const path = require('path');
const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
import(path.join(dir, 'dist', 'claude', 'statusline.js'))
  .then((m) => m.main())
  .catch(() => { /* graft not built or unavailable — render nothing */ });
