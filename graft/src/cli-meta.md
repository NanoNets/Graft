# src/cli-meta.ts

This file provides support for version management and upgrade functionality for the graft package, including version resolution and reporting.

- resolvePackageJsonPath · function · L17-L24 — Determines the path to the package.json file for a given module URL, enabling access to package metadata.
- readCurrentVersion · function · L27-L31 — Retrieves the current version of the graft package from its package.json file, ensuring the application uses the correct version.
- isRunningViaNpx · function · L35-L37 — Checks if the current module is executed from an npx cache directory, affecting how upgrades are handled.
- NpmViewResult · interface · L39-L42 — Defines the structure for the result of an npm view command, indicating success and the version of a package.
- getNpmViewVersion · function · L46-L60 — Fetches the version of a specified package from npm, handling errors gracefully to ensure reliability.
- formatVersionReport · function · L63-L73 — Formats a report on the current and latest package versions for user-friendly output.
- globalRoot · function · L76-L87 — Determines the global npm node_modules directory, accommodating various installation layouts.
- readGlobalInstalledVersion · function · L92-L103 — Reads the installed version of a package directly from the global node_modules directory, providing accurate local versioning.
- UpgradeResult · interface · L105-L113 — Defines the structure for the result of an upgrade operation, indicating whether it was executed and its success status.
- formatUpgradeReport · function · L116-L127 — Generates a user-friendly report after an upgrade attempt, indicating success or failure.
- runUpgrade · function · L132-L143 — Executes the upgrade process for the graft package, ensuring the latest version is installed unless running via npx.
