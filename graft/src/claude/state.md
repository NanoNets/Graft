# src/claude/state.ts

Manages application state and session data, including statistics and file locking mechanisms.

- Stats · interface · L4-L9 — Defines the structure for tracking various statistics related to nodes and edges in the system.
- SessionState · interface · L10-L20 — Defines the structure for maintaining the state of a session, including queries and token savings.
- emptyStats · function · L24-L27 — Creates and returns an initial empty Stats object to reset statistics tracking.
- emptySession · function · L28-L30 — Creates and returns an initial empty SessionState object to reset session tracking.
- cacheDir · function · L32-L32 — Constructs the path to the cache directory for a given project.
- statsPath · function · L33-L33 — Generates the file path for storing statistics in JSON format.
- sessionPath · function · L34-L34 — Generates the file path for storing session data in JSON format.
- lockPath · function · L35-L35 — Generates the file path for the synchronization lock used in the caching mechanism.
- readJson · function · L37-L39 — Reads and parses a JSON file, returning the content or null if an error occurs.
- writeJsonAtomic · function · L40-L45 — Writes a JSON object to a file atomically, ensuring no data corruption during the write process.
- readStats · function · L47-L47 — Reads the statistics from the specified path, returning null if not found.
- writeStats · function · L48-L48 — Writes the provided statistics to the specified path in JSON format.
- patchStats · function · L51-L55 — Updates the existing statistics with a patch and writes the updated stats back to storage.
- readSession · function · L56-L58 — Reads the session data from the specified path, returning an empty session if not found.
- writeSession · function · L59-L61 — Writes the session data to the specified path in JSON format.
- acquireLock · function · L63-L79 — Attempts to acquire a lock for the specified directory to prevent concurrent access issues.
- releaseLock · function · L80-L80 — Releases the lock for the specified directory, allowing other processes to access it.
