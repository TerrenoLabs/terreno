# Validate a block document locally

`terreno-blocks` checks one whole-reply YAML or JSON document before you send it.

1. Compile the package so the bin exists: `cd blocks && bun run compile`.
2. Run `terreno-blocks validate path/to/document.yaml`.
3. A valid document exits 0. Each problem prints as `path  CODE  message — fix` and the
   process exits 1.
4. Pass `-` to read the document from stdin.

The same check is `validateBlocks` in `@terreno/blocks`. Field tables are in the
[blocks reference](../reference/blocks.md).
