# Config schema fragments

Each file here is one property of [`../v0.schema.json`](../v0.schema.json), named for the config option it describes: `ignore.json` holds the schema of the `ignore` option, and nothing else. Adding or changing a config option means adding or editing one file here — never the built schema.

- Name a file `<option>.json`. The option's schema is the file's whole JSON object.
- `README.md` is the only file that is not a fragment.

`npm run schema:build` folds the fragments into `../v0.schema.json`, sorting the properties byte-wise so the output is identical on every platform. `npm run check:schema` fails when the built file is out of date. Do not edit the built file by hand: the schema changes only additively (see [`../../README.md`](../../README.md)), and a new option is a new fragment.
