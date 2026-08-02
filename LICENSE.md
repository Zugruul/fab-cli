# License

This repository is a monorepo containing multiple independently licensed packages.
There is no single repo-wide license — each package carries its own:

| Package | License | License file |
|---|---|---|
| [`fab-cli`](fab-cli/) | GPL-3.0-only | [`fab-cli/LICENSE`](fab-cli/LICENSE) |
| [`fab-app`](fab-app/) | MIT | [`fab-app/LICENSE`](fab-app/LICENSE) |
| [`pipeline`](pipeline/) | MIT | [`pipeline/LICENSE`](pipeline/LICENSE) |
| [`manifest-schema`](manifest-schema/) | MIT | [`manifest-schema/LICENSE`](manifest-schema/LICENSE) |

The root `package.json` is private (never published) and carries no license claim of its own.

**GPL isolation:** because `fab-cli` is GPL-3.0-only and `fab-app`/`pipeline`/`manifest-schema`
are MIT and App-Store-bound, `fab-app`, `pipeline`, and `manifest-schema` never declare a
workspace dependency on `fab-cli` or import its source. Any interaction between them is
process-boundary only (spawning the CLI as a subprocess) or via shared data files — never a
code-level dependency. See [`docs/spec-deltas/APP-004.md`](docs/spec-deltas/APP-004.md) for the
recorded decision.
