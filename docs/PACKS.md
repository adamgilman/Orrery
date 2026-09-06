# Vocabulary packs

A pack is a vocabulary shipped with the tool: kinds bound to icons and frames, or states bound to looks. A model
pulls one in and then overrides, extends or ignores it as it does the defaults (MODEL.md 4.8, R13).

```jsonc
"kinds":  { "use": ["aws"] },            // then "kind": "aws:s3", "aws:lambda", "aws:rds", "aws:vpc" (a group)
"states": { "use": "sre" }               // then "state": "impaired", "brownout", "outage", "drained"
```

`orrery packs` lists the packs; `orrery packs aws` lists every name in one with its description. Every icon in a
provider's set is a kind, under a name derived from the provider's file name (`aws:simple-storage-service`) and,
for the services people name in conversation, an alias (`aws:s3`). A kinds pack also defines a few group kinds as
frames in the provider's colours (`aws:vpc`, `gcp:project`, `azure:resource-group`).

| Pack | What | Source | Version | Fetched |
|---|---|---|---|---|
| `aws` | 300 service icons, 64×64, coloured square; 10 group frames | [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/) via the `aws-icons` npm package (an MIT-licensed wrapper of the official asset package) | 01/30/2026 | 2026-09-06 |
| `azure` | 636 service icons, 18×18; 7 group frames | [Azure Public Service Icons](https://learn.microsoft.com/en-us/azure/architecture/icons/) | V24 (July 2026) | 2026-09-06 |
| `gcp` | 216 legacy product icons (24×24) and 19 current core product icons (512×512); 7 group frames | [Google Cloud icons](https://cloud.google.com/icons), the legacy and core products downloads | as published on the fetch date | 2026-09-06 |
| `sre` | five states: healthy, impaired, brownout, outage, drained; default `healthy` | this repository | 1 | |

## Terms

The icons belong to their providers. Each pack's `terms` field carries the provider's wording, repeated here.
The packs exist to draw architecture diagrams, which is the use each provider permits; anything else is between
you and the provider.

- **AWS.** "AWS Architecture Icons are provided by Amazon Web Services for customers and partners to use in
  architecture diagrams." See the AWS Architecture Icons page and the terms in the asset package.
- **Azure.** "Microsoft permits the use of these icons in architectural diagrams, training materials, or
  documentation. You can copy, distribute, and display the icons only for the permitted use unless granted
  explicit permission by Microsoft. Microsoft reserves all other rights." Their guidelines add: do not crop, flip,
  rotate or distort an icon; do not use a Microsoft icon to represent your own product.
- **Google Cloud.** Google offers the icons on its icons page for building architecture diagrams. No separate
  licence text accompanies the download.

## How a pack is built

`node tools/packs/build.mjs` writes `packages/core/packs/*.json`. It reads the AWS set from `node_modules/aws-icons`,
downloads the Azure and Google zips once into `tools/packs/cache/`, and normalises every SVG: XML declaration,
comments and titles dropped; `<style>` class rules inlined as style attributes (the sets reuse class names across
icons); ids that nothing references dropped and the rest prefixed with the kind's name (gradients, clip paths);
`xlink:href` rewritten as `href`; markup with script, foreignObject, image or an event handler refused. The
result is a `{ "viewBox", "svg" }` glyph the renderer draws as a nested `<svg>` in the box's glyph slot, 20×20.

Names: an AWS file `AmazonSimpleStorageService` becomes `simple-storage-service` with the description "Amazon
Simple Storage Service"; Azure `10130-icon-service-SQL-Database` becomes `sql-database`; Google `cloud_sql`
becomes `cloud-sql`. The alias tables in the script add `s3`, `lambda`, `ec2`, `rds`, `dynamodb`, `sqs`, `sns`,
`eks`, `ecs`, `cloudfront`, `run`, `gke`, `cloudsql`, `pubsub`, `aks`, `cosmos`, `functions`, `app-service`,
`blob`, `service-bus`, `key-vault` and the rest; an alias is the same kind under a second name.

The generated files are committed. Re-run the script to pick up a new icon release, and read the diff.
