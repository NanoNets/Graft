---
name: Host Management and Configuration
slug: host-management-and-configuration
type: system
sources:
  - path: src/hosts/codex-hooks.ts
    hash: 0b9ba9ba677876d1adf4ce8d05aa534cddfbdeb7060ed11a92111a41a76d1512
  - path: src/hosts/init.ts
    hash: cd3ef307f207a48b82fa81ea55e34fdc97b8663612ad639a3256336d5531afa0
  - path: src/hosts/instructions.ts
    hash: 1dddea660f4d5e65952faf2beee42f04153ccab893658e75bda1dce6c0245b18
  - path: src/hosts/mcp-config.ts
    hash: c3a3dea18371806ed352e7cab582265db2341b7d4ea5797578e495b512a9b0b3
  - path: src/hosts/registry.ts
    hash: 0a8a2b82f0e4e1010943eb69d2eee7d9c4549f884967d5af1b8317c38ef99c18
  - path: src/hosts/sections.ts
    hash: f172618889d5a02683032df8c69dd85b71c00c72a8b76958305ade22d6cda714
sources_digest: da51b260a6b5e65f9dc1fa578e44a81309e6379f05f575b42378a1a646d63bb7
links:
  - to: graph-extraction-and-loading
    relation: part_of
    description: >-
      This system is part of the overall architecture that supports host
      interactions.
  - to: graph-representation
    relation: configures
    description: >-
      It configures the behavior of the graph representation based on host
      settings.
generator:
  version: 1
covers:
  - symbol: HookWrite
    kind: interface
    at: 'src/hosts/codex-hooks.ts:L11-L15'
  - symbol: dirExists
    kind: function
    at: 'src/hosts/codex-hooks.ts:L17-L19'
  - symbol: writeOwned
    kind: function
    at: 'src/hosts/codex-hooks.ts:L21-L31'
  - symbol: isGraftEntry
    kind: function
    at: 'src/hosts/codex-hooks.ts:L33-L35'
  - symbol: installCodexHooks
    kind: function
    at: 'src/hosts/codex-hooks.ts:L37-L74'
  - symbol: HostsInitResult
    kind: interface
    at: 'src/hosts/init.ts:L14-L20'
  - symbol: probeFor
    kind: function
    at: 'src/hosts/init.ts:L22-L27'
  - symbol: writeOwned
    kind: function
    at: 'src/hosts/init.ts:L29-L35'
  - symbol: runHostsInit
    kind: function
    at: 'src/hosts/init.ts:L37-L72'
  - symbol: instructionBody
    kind: function
    at: 'src/hosts/instructions.ts:L6-L43'
  - symbol: cursorRule
    kind: function
    at: 'src/hosts/instructions.ts:L45-L52'
  - symbol: kiroSteering
    kind: function
    at: 'src/hosts/instructions.ts:L54-L60'
  - symbol: windsurfRule
    kind: function
    at: 'src/hosts/instructions.ts:L62-L65'
  - symbol: McpWrite
    kind: interface
    at: 'src/hosts/mcp-config.ts:L10-L14'
  - symbol: dirExists
    kind: function
    at: 'src/hosts/mcp-config.ts:L19-L21'
  - symbol: mergeJsonKey
    kind: function
    at: 'src/hosts/mcp-config.ts:L23-L43'
  - symbol: upsertCodexToml
    kind: function
    at: 'src/hosts/mcp-config.ts:L45-L54'
  - symbol: registerMcpConfigs
    kind: function
    at: 'src/hosts/mcp-config.ts:L56-L87'
  - symbol: DetectProbe
    kind: interface
    at: 'src/hosts/registry.ts:L12-L16'
  - symbol: HostTarget
    kind: interface
    at: 'src/hosts/registry.ts:L18-L26'
  - symbol: hostIds
    kind: function
    at: 'src/hosts/registry.ts:L82-L84'
  - symbol: detectHosts
    kind: function
    at: 'src/hosts/registry.ts:L86-L88'
  - symbol: UpsertAction
    kind: type
    at: 'src/hosts/sections.ts:L11-L11'
  - symbol: LineEnding
    kind: type
    at: 'src/hosts/sections.ts:L13-L13'
  - symbol: fencedBlock
    kind: function
    at: 'src/hosts/sections.ts:L15-L21'
  - symbol: detectEol
    kind: function
    at: 'src/hosts/sections.ts:L24-L26'
  - symbol: markerLineIndex
    kind: function
    at: 'src/hosts/sections.ts:L29-L34'
  - symbol: upsertSection
    kind: function
    at: 'src/hosts/sections.ts:L36-L67'
---
<!-- context:generated:start -->
## Summary

This component manages the configuration and initialization of various coding hosts, allowing the Graft system to interact with different environments. It includes functionality for setting up hooks, managing instruction files, and ensuring that the environment is correctly configured for user interactions.

## Related

- part of [[graph-extraction-and-loading]] — This system is part of the overall architecture that supports host interactions.
- configures [[graph-representation]] — It configures the behavior of the graph representation based on host settings.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
