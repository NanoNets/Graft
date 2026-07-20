import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface Stats {
  nodeCount: number; edgeCount: number; languages: string[];
  totalCount: number; readyCount: number;
  staleCount: number; dirty: boolean; syncing: boolean;
  syncedAt: string | null; lastFile: string | null;
}
export interface SessionState {
  lastQuery: string | null;
  perAgentQuery: Record<string, string>;
  graftReads: number; sourceReads: number;
}

export const LOCK_STALE_MS = 300000;

export function emptyStats(): Stats {
  return { nodeCount: 0, edgeCount: 0, languages: [], totalCount: 0, readyCount: 0,
    staleCount: 0, dirty: false, syncing: false, syncedAt: null, lastFile: null };
}
function emptySession(): SessionState {
  return { lastQuery: null, perAgentQuery: {}, graftReads: 0, sourceReads: 0 };
}

export function cacheDir(projectDir: string): string { return join(projectDir, 'graft', '.cache'); }
function statsPath(d: string): string { return join(cacheDir(d), 'stats.json'); }
function sessionPath(d: string, id: string): string { return join(cacheDir(d), 'session', `${id}.json`); }
function lockPath(d: string): string { return join(cacheDir(d), '.sync.lock'); }

function readJson<T>(p: string): T | null {
  try { return JSON.parse(readFileSync(p, 'utf8')) as T; } catch { return null; }
}
function writeJsonAtomic(p: string, value: unknown): void {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, p);
}

export function readStats(d: string): Stats | null { return readJson<Stats>(statsPath(d)); }
export function writeStats(d: string, s: Stats): void { writeJsonAtomic(statsPath(d), s); }
export function patchStats(d: string, patch: Partial<Stats>): Stats {
  const next: Stats = { ...(readStats(d) ?? emptyStats()), ...patch };
  writeStats(d, next);
  return next;
}
export function readSession(d: string, id: string): SessionState {
  return readJson<SessionState>(sessionPath(d, id)) ?? emptySession();
}
export function writeSession(d: string, id: string, s: SessionState): void {
  writeJsonAtomic(sessionPath(d, id), s);
}

export function acquireLock(d: string): boolean {
  const p = lockPath(d);
  mkdirSync(cacheDir(d), { recursive: true });
  const payload = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
  try {
    writeFileSync(p, payload, { flag: 'wx' }); // atomic exclusive create
    return true;
  } catch (e: any) {
    if (e?.code !== 'EEXIST') throw e;
    let stale: boolean;
    try { stale = Date.now() - statSync(p).mtimeMs >= LOCK_STALE_MS; } catch { stale = true; }
    if (!stale) return false;
    try { rmSync(p); } catch { /* another process reclaimed it */ }
    try { writeFileSync(p, payload, { flag: 'wx' }); return true; }
    catch (e2: any) { if (e2?.code === 'EEXIST') return false; throw e2; }
  }
}
export function releaseLock(d: string): void { try { rmSync(lockPath(d)); } catch { /* already gone */ } }
