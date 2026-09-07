# @orrery-diagrams/pack-azure

Azure Public Service Icons as an [Orrery](https://github.com/adamgilman/Orrery) vocabulary pack: 688 icons as kinds and 7
group frames in the provider's colours. **The icons are Microsoft's and come under their terms, which are
in [LICENSE](LICENSE), not under Orrery's MIT licence.** Set version V24, fetched 2026-09-06, from
https://learn.microsoft.com/en-us/azure/architecture/icons/.

```sh
npm install @orrery-diagrams/pack-azure      # or yarn add, pnpm add, bun add
```

```jsonc
"kinds": { "use": ["azure"] }   // then "kind": "azure:aks", "azure:functions", "azure:sql-database", "azure:resource-group" ...
```

`orrery packs azure` lists every name with its description. In code, pass the pack to the validator:
`validate(model, { packs: [pack] })` with `pack` imported from this package. How the pack is built, and the
terms of every pack, are in [docs/PACKS.md](https://github.com/adamgilman/Orrery/blob/main/docs/PACKS.md).
