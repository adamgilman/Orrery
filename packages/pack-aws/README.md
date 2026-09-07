# @orrery-diagrams/pack-aws

AWS Architecture Icons as an [Orrery](https://github.com/adamgilman/Orrery) vocabulary pack: 329 icons as kinds and 10
group frames in the provider's colours. **The icons are Amazon Web Services's and come under their terms, which are
in [LICENSE](LICENSE), not under Orrery's MIT licence.** Set version 01/30/2026, fetched 2026-09-06, from
https://aws.amazon.com/architecture/icons/.

```sh
npm install @orrery-diagrams/pack-aws      # or yarn add, pnpm add, bun add
```

```jsonc
"kinds": { "use": ["aws"] }   // then "kind": "aws:s3", "aws:lambda", "aws:rds", "aws:vpc" ...
```

`orrery packs aws` lists every name with its description. In code, pass the pack to the validator:
`validate(model, { packs: [pack] })` with `pack` imported from this package. How the pack is built, and the
terms of every pack, are in [docs/PACKS.md](https://github.com/adamgilman/Orrery/blob/main/docs/PACKS.md).
