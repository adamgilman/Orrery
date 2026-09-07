# @orrery-diagrams/pack-gcp

Google Cloud product icons as an [Orrery](https://github.com/adamgilman/Orrery) vocabulary pack: 257 icons as kinds and 7
group frames in the provider's colours. **The icons are Google's and come under their terms, which are
in [LICENSE](LICENSE), not under Orrery's MIT licence.** Set version legacy set and core products set as published on 2026-09-06, fetched 2026-09-06, from
https://cloud.google.com/icons.

```sh
npm install @orrery-diagrams/pack-gcp      # or yarn add, pnpm add, bun add
```

```jsonc
"kinds": { "use": ["gcp"] }   // then "kind": "gcp:run", "gcp:gke", "gcp:cloud-sql", "gcp:project" ...
```

`orrery packs gcp` lists every name with its description. In code, pass the pack to the validator:
`validate(model, { packs: [pack] })` with `pack` imported from this package. How the pack is built, and the
terms of every pack, are in [docs/PACKS.md](https://github.com/adamgilman/Orrery/blob/main/docs/PACKS.md).
