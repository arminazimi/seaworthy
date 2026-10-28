# Report schema fragments

Each file here is one part of [`../v0.schema.json`](../v0.schema.json), named for the field it describes, so a new report field adds a file instead of editing the built schema.

- `fields/<key>.json` — a top-level report field, such as `fields/prompt.json`. `<key>.required.json` also lists the key in the report's `required`. `summary` is not allowed here: it is assembled from `summary/`.
- `summary/<key>.json` — a field of the report's `summary` object, with the same `.required` rule.
- `defs/<name>.json` — one `$defs` entry, so `$ref` targets such as `#/$defs/finding` have a home per feature.
- `README.md` is the only file that is not a fragment.

`npm run schema:build` folds the fragments into `../v0.schema.json`, sorting keys and `required` lists byte-wise so the output is identical on every platform. `npm run check:schema` fails when the built file is out of date. Do not edit the built file by hand: the report format changes only additively (see [`../../README.md`](../../README.md)), and a new optional field is a new fragment.
