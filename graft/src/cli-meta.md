# src/cli-meta.ts

- resolvePackageJsonPath · function · L17-L24 — function resolvePackageJsonPath(moduleUrl: string): string
- readCurrentVersion · function · L27-L31 — function readCurrentVersion(moduleUrl: string): string
- isRunningViaNpx · function · L35-L37 — function isRunningViaNpx(moduleUrl: string): boolean
- NpmViewResult · interface · L39-L42 — interface NpmViewResult
- getNpmViewVersion · function · L46-L60 — function getNpmViewVersion(pkgName: string = PKG_NAME, timeoutMs = 2000): NpmViewResult
- formatVersionReport · function · L63-L73 — function formatVersionReport(current: string, latest: NpmViewResult): string
- globalRoot · function · L76-L87 — function globalRoot(): string | null
- readGlobalInstalledVersion · function · L92-L103 — function readGlobalInstalledVersion(pkgName: string = PKG_NAME): string | null
- UpgradeResult · interface · L105-L113 — interface UpgradeResult
- formatUpgradeReport · function · L116-L127 — function formatUpgradeReport(result: UpgradeResult): string
- runUpgrade · function · L132-L143 — function runUpgrade(moduleUrl: string): UpgradeResult
