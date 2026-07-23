# src/ask/graphrank.ts

This module implements a personalized PageRank algorithm to improve the ranking of code nodes based on their structural relevance rather than just lexical similarity.

- PageRankOptions · interface · L20-L26 — Defines options for configuring the personalized PageRank algorithm, including restart probability and iteration count.
- personalizedPageRank · function · L39-L101 — Calculates personalized PageRank scores for nodes in a wiring graph based on provided seeds, enhancing the relevance of code suggestions.
- link · function · L51-L53 — Creates undirected links between nodes in the graph for the PageRank calculation, ensuring that both directions are considered.
