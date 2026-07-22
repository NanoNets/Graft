# src/ask/index-file.ts

- tokenize · function · L38-L44 — function tokenize(text: string): string[]
- counts · function · L47-L51 — function counts(tokens: string[]): Map<string, number>
- AskIndexDoc · interface · L54-L59 — interface AskIndexDoc
- AskIndex · interface · L63-L69 — interface AskIndex
- askIndexPath · function · L76-L78 — function askIndexPath(outDir: string): string
- pairs · function · L80-L82 — function pairs(m: Map<string, number>): [string, number][]
- bagLen · function · L85-L89 — function bagLen(p: [string, number][]): number
- writeAskIndex · function · L98-L131 — function writeAskIndex(outDir: string, graph: GraphV1): string
- readAskIndex · function · L138-L159 — function readAskIndex(outDir: string): AskIndex | null
