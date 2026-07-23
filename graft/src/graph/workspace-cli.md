# src/graph/workspace-cli.ts

- WorkspaceBuildOptions · interface · L24-L32 — interface WorkspaceBuildOptions
- runWorkspaceBuild · function · L37-L57 — async function runWorkspaceBuild(root: string, opts: WorkspaceBuildOptions): Promise<void>
- buildChild · function · L38-L44 — buildChild = async (childDir: string, childName: string): Promise<void>
- runWorkspaceAsk · function · L59-L68 — function runWorkspaceAsk( root: string, override: string | undefined, query: string, opts: { limit?: number; source?: boolean; full?: boolean; in?: string; json?: boolean }, ): void
- runWorkspaceGrep · function · L70-L87 — function runWorkspaceGrep( root: string, override: string | undefined, pattern: string, opts: { ignoreCase?: boolean; fixed?: boolean; json?: boolean }, ): void
- runWorkspaceMap · function · L89-L95 — function runWorkspaceMap( root: string, override: string | undefined, opts: { maxDirs?: number }, ): void
- runWorkspaceCheck · function · L97-L101 — function runWorkspaceCheck(root: string, override?: string): void
- runWorkspaceCallers · function · L103-L115 — function runWorkspaceCallers( root: string, override: string | undefined, symbol: string, opts: { direction?: Direction; depth?: number; in?: string }, ): void
