# Reference

`reference/prototype/` is the approved prototype, imported unmodified from
`caroline-packing-wireframe` at commit `539c448e`. It is the behavioral and
visual source of truth for the app.

It is **not shipped code**. It is excluded from build, lint, typecheck, and
coverage. Do not edit it; if the prototype and the design plan disagree, ask in
`#design-decisions`.

The prototype's own tests run from its directory:

```
cd reference/prototype
node tests/core.test.mjs
node tests/static.test.mjs
```
