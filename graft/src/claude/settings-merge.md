# src/claude/settings-merge.ts

- Json · type · L1-L1 — type Json = Record<string, any>;
- hookCmd · function · L7-L9 — function hookCmd(arg: string): string
- graftBlocks · function · L10-L17 — function graftBlocks(): Record<string, Json>
- isGraftHookEntry · function · L18-L20 — function isGraftHookEntry(entry: Json): boolean
- mergeGraftSettings · function · L22-L55 — function mergeGraftSettings(existing: Json): { merged: Json; warnings: string[] }
