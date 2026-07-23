# src/graph/load.ts · [[graph-extraction-and-loading]]

This module implements a caching mechanism to optimize the loading of graph and ask index data by avoiding unnecessary re-parsing of files when their metadata has not changed.

- CacheEntry · interface · L31-L35 — Defines the structure for cache entries, encapsulating the metadata and value of cached items to facilitate efficient cache management.
- __resetParseCounts · function · L45-L48 — Resets the counters that track the number of cache misses for graph and ask index parsing, ensuring a clean state for tests.
- statOf · function · L50-L57 — Retrieves the metadata (mtime and size) of a file, returning null if the file does not exist, which is essential for cache validation.
- loadCached · function · L59-L81 — Loads a cached value from a specified cache, re-parsing the value if the file's metadata has changed, thus ensuring up-to-date data retrieval.
- loadGraphCached · function · L86-L91 — Caches the result of reading a graph from a file, ensuring that it is only re-read when the file's metadata indicates a change.
- loadAskIndexCached · function · L95-L100 — Caches the result of reading an ask index from a file, ensuring that it is only re-read when the file's metadata indicates a change.
