---
name: Testing and Validation
slug: testing-and-validation
type: system
sources:
  - path: test/ask-index.test.ts
    hash: c9cd7c011ebd661f35488c59dcd34801079f2786d56e96833f4da7c45dfa37d7
  - path: test/ask.test.ts
    hash: 3445f8b156ba6b2f0e9123e9fc45781da352ec6d5baeb985ee144fe5aecaafb3
  - path: test/claude-format.test.ts
    hash: cfaa9f489dd95956e3c9917ebe29a46992dfdbab943b5971eecbd98f18b3268c
  - path: test/claude-hooks.test.ts
    hash: 875c10776da455499b58ebe861b3cb0ae797f751e4e838812cd0b4f3c13587c2
  - path: test/claude-init.test.ts
    hash: b582cd79b2a1e4952ff83ac1b2e85f742756443c2896e08d96a75dc76e2971a5
  - path: test/claude-paths.test.ts
    hash: 205740f8110e72e4cb24652c09f763fad5e056dc77776bcfa95a1953731ed2c8
  - path: test/claude-settings-merge.test.ts
    hash: 4c8b800f02d1b72050082bdbcdcda0878e5d9760563d2e1ca4a31cb06ffaaabb
  - path: test/claude-shim-template.test.ts
    hash: f787f99fef2dc6a5ed366419fc470e8e4f825e0bc590cf3550d39e01995e7619
  - path: test/claude-skill-template.test.ts
    hash: 49f60183a51f9c307a33b5d4da3a7ded2f55509407e6a85778f3512b27db7cde
  - path: test/claude-state.test.ts
    hash: 78e6a81af7642ea788072457ea181bc626c7a8a898cfebb882ab42fed7e9dd2e
  - path: test/claude-stats.test.ts
    hash: f625d026d152a65017699e37e27534043dc0af0f43ba2d3ea778bac8ddab82c3
  - path: test/claude-statusline.test.ts
    hash: 07128b5b195af3a37c1e170a35c18378e36160d1a6f8e17be362bac315811cac
  - path: test/cli-meta.test.ts
    hash: e7a05bf838e876a317276f94a26d92b0b1526e1ea7eabda4e68b804bdb0334e5
  - path: test/context.test.ts
    hash: 126861c136d48ed6a148e50226c96ec2935c52cf83ef56fbd43392e0d271db1f
  - path: test/covers.test.ts
    hash: f5a75f405be1a01ad43fc806588858df3a8988fee62ad4ec024440d3f5e0fc0c
  - path: test/graph-bindings.test.ts
    hash: b6892b1b6982547fc67d5b0e7812a536e47018ab3e38e4eda35a0f12f24ab8db
  - path: test/graph-go.test.ts
    hash: bf11085a7edb03c00d52dca090af9c1ca4eb3cb34bb88904bbdd478171d3483d
  - path: test/graph-load.test.ts
    hash: 8df11988d049b5243d8c7a0d55045163b714965897448797b40c8ef458b0896b
  - path: test/graph-map.test.ts
    hash: 97c06030735d5dbb15270b73a594e1de8fb3ffba5c6551b6303a5357b8da31be
  - path: test/graph-resolve-typed.test.ts
    hash: 0c3760525cc61ee97de448fa26b4a5b9a3bb07c03b4acfbdf3608541b189cf81
  - path: test/graph-traverse-cli.test.ts
    hash: d79347b0640178631235552105c0518029305ead4990726470d3adf5a1b52f09
sources_digest: ec26f442eeea6bac55ed94939624004883ed25f71e6271fccd772f42743774f0
links:
  - to: graph-extraction-and-loading
    relation: validates
    description: It validates the extraction and loading functionalities.
  - to: graph-traversal-and-analysis
    relation: validates
    description: It ensures that traversal and analysis functions perform correctly.
  - to: host-management-and-configuration
    relation: validates
    description: It tests the configuration and initialization processes for hosts.
generator:
  version: 1
covers:
  - symbol: makeFixture
    kind: function
    at: 'test/ask-index.test.ts:L26-L50'
  - symbol: reinjectBodyText
    kind: function
    at: 'test/ask-index.test.ts:L69-L85'
  - symbol: sortPairs
    kind: function
    at: 'test/ask-index.test.ts:L106-L106'
  - symbol: makeFixture
    kind: function
    at: 'test/ask.test.ts:L16-L25'
  - symbol: stampCrux
    kind: function
    at: 'test/ask.test.ts:L43-L49'
  - symbol: qualifiedFixture
    kind: function
    at: 'test/ask.test.ts:L189-L207'
  - symbol: strip
    kind: function
    at: 'test/claude-format.test.ts:L6-L6'
  - symbol: gateAsk
    kind: function
    at: 'test/claude-format.test.ts:L97-L104'
  - symbol: freshSession
    kind: function
    at: 'test/claude-format.test.ts:L105-L105'
  - symbol: runWithStdin
    kind: function
    at: 'test/claude-hooks.test.ts:L38-L41'
  - symbol: fakeBuild
    kind: function
    at: 'test/claude-hooks.test.ts:L84-L87'
  - symbol: fresh
    kind: function
    at: 'test/claude-init.test.ts:L10-L10'
  - symbol: runPostinstall
    kind: function
    at: 'test/claude-init.test.ts:L12-L17'
  - symbol: col
    kind: function
    at: 'test/claude-init.test.ts:L116-L116'
  - symbol: fresh
    kind: function
    at: 'test/claude-state.test.ts:L11-L11'
  - symbol: repo
    kind: function
    at: 'test/claude-statusline.test.ts:L9-L9'
  - symbol: writeWiring
    kind: function
    at: 'test/claude-statusline.test.ts:L10-L13'
  - symbol: runCli
    kind: function
    at: 'test/context.test.ts:L19-L30'
  - symbol: makeFixture
    kind: function
    at: 'test/context.test.ts:L32-L43'
  - symbol: buildOpts
    kind: function
    at: 'test/context.test.ts:L45-L47'
  - symbol: makeFixture
    kind: function
    at: 'test/covers.test.ts:L16-L24'
  - symbol: callEdges
    kind: function
    at: 'test/graph-bindings.test.ts:L5-L7'
  - symbol: makeFixture
    kind: function
    at: 'test/graph-go.test.ts:L53-L60'
  - symbol: nodeById
    kind: function
    at: 'test/graph-go.test.ts:L62-L64'
  - symbol: node
    kind: function
    at: 'test/graph-load.test.ts:L23-L38'
  - symbol: fixtureDir
    kind: function
    at: 'test/graph-load.test.ts:L40-L42'
  - symbol: bump
    kind: function
    at: 'test/graph-load.test.ts:L46-L50'
  - symbol: fileNode
    kind: function
    at: 'test/graph-map.test.ts:L16-L31'
  - symbol: symNode
    kind: function
    at: 'test/graph-map.test.ts:L33-L49'
  - symbol: edge
    kind: function
    at: 'test/graph-map.test.ts:L51-L53'
  - symbol: graphOf
    kind: function
    at: 'test/graph-map.test.ts:L55-L61'
  - symbol: bigFixture
    kind: function
    at: 'test/graph-map.test.ts:L240-L259'
  - symbol: 'n'
    kind: function
    at: 'test/graph-resolve-typed.test.ts:L6-L10'
  - symbol: builtRepo
    kind: function
    at: 'test/graph-traverse-cli.test.ts:L16-L27'
  - symbol: runCli
    kind: function
    at: 'test/graph-traverse-cli.test.ts:L29-L40'
---
<!-- context:generated:start -->
## Summary

This component encompasses various test suites designed to validate the functionality and reliability of the Graft system, ensuring that all components work as intended and that changes do not introduce regressions. It includes tests for extraction, loading, traversal, and host management.

## Related

- validates [[graph-extraction-and-loading]] — It validates the extraction and loading functionalities.
- validates [[graph-traversal-and-analysis]] — It ensures that traversal and analysis functions perform correctly.
- validates [[host-management-and-configuration]] — It tests the configuration and initialization processes for hosts.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
