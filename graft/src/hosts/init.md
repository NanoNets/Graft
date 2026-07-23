# src/hosts/init.ts · [[host-management-and-configuration]]

Initializes host configurations by writing instruction files based on selected hosts, ensuring that the correct files are created or updated as needed.

- HostsInitResult · interface · L14-L20 — Defines the structure of the result returned by the host initialization process, capturing written, skipped, and unknown hosts along with MCP and hooks data.
- probeFor · function · L22-L27 — Creates a probe object to check for the existence of directories in a specified repository, facilitating host detection.
- writeOwned · function · L29-L35 — Writes content to a specified path, creating or replacing the file as necessary, and returns the action taken.
- runHostsInit · function · L37-L72 — Initializes hosts by selecting them based on provided options and writing their instruction files, while also handling MCP configurations and hooks.
