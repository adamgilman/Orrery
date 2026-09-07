# Vocabulary packs

A pack is a vocabulary a model pulls in by name: kinds bound to icons and frames, or states bound to looks. A model
uses one and then overrides, extends or ignores it as it does the defaults (MODEL.md 4.8, R13).

```jsonc
"kinds":  { "use": ["aws"] },            // then "kind": "aws:s3", "aws:lambda", "aws:rds", "aws:vpc" (a group)
"states": { "use": "sre" }               // then "state": "impaired", "brownout", "outage", "drained"
```

## Whose they are

The code of Orrery is MIT. The providers' icons are not Orrery's to license, so each icon set is its own npm
package under the provider's own terms, and a model that uses one needs it installed. Installing it is your
acceptance of those terms; the package's `LICENSE` file carries them verbatim, and its manifest says
`SEE LICENSE IN LICENSE`, not MIT. The tool itself ships only `sre`, its own states vocabulary.

```sh
npm install @orrery-diagrams/pack-aws     # or yarn add, pnpm add, bun add; the same for pack-azure, pack-gcp
```

| Pack | Package | What | Source | Version | Fetched |
|---|---|---|---|---|---|
| `aws` | `@orrery-diagrams/pack-aws` | 300 service icons, 64×64, coloured square; 10 group frames | [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/) via the `aws-icons` npm package (an MIT-licensed wrapper of the official asset package) | 01/30/2026 | 2026-09-06 |
| `azure` | `@orrery-diagrams/pack-azure` | 636 service icons, 18×18; 7 group frames | [Azure Public Service Icons](https://learn.microsoft.com/en-us/azure/architecture/icons/) | V24 (July 2026) | 2026-09-06 |
| `gcp` | `@orrery-diagrams/pack-gcp` | 216 legacy product icons (24×24) and 19 current core product icons (512×512); 7 group frames | [Google Cloud icons](https://cloud.google.com/icons), the legacy and core products downloads | as published on the fetch date | 2026-09-06 |
| `sre` | with the tool (`@orrery-diagrams/core`, MIT) | five states: healthy, impaired, brownout, outage, drained; default `healthy` | this repository | 1 | |

A model naming a pack that is not installed fails validation with the package to add:
`/kinds/use/0: pack "aws" is not installed: add @orrery-diagrams/pack-aws (AWS Architecture Icons, Amazon Web
Services' icons under their terms)`. `orrery packs` lists every pack with its package, installed or not;
`orrery packs aws` lists every name in one with its description. In code, where nothing is installed by name (a
browser, a bundler), pass the packs to the validator: `validate(model, { packs: [aws] })` with the pack imported
from its package.

Every icon in a provider's set is a kind, under a name derived from the provider's file name
(`aws:simple-storage-service`) and, for the services people name in conversation, an alias (`aws:s3`). A kinds
pack also defines a few group kinds as frames in the provider's colours (`aws:vpc`, `gcp:project`,
`azure:resource-group`); those frames are drawn by Orrery, not taken from the provider.

## Terms

Each package's `LICENSE` carries the provider's wording, repeated here. The packs exist to draw architecture
diagrams, which is the use each provider permits; anything else is between you and the provider. The pictures
in this repository's README and site are architecture diagrams drawn with the AWS pack, which is that use.

- **AWS.** "AWS Architecture Icons are provided by Amazon Web Services for customers and partners to use in
  architecture diagrams." See the AWS Architecture Icons page and the terms in the asset package.
- **Azure.** "Microsoft permits the use of these icons in architectural diagrams, training materials, or
  documentation. You can copy, distribute, and display the icons only for the permitted use unless granted
  explicit permission by Microsoft. Microsoft reserves all other rights." Their guidelines add: do not crop, flip,
  rotate or distort an icon; do not use a Microsoft icon to represent your own product.
- **Google Cloud.** Google offers the icons on its icons page for building architecture diagrams. No separate
  licence text accompanies the download.

## How a pack is built

`node tools/packs/build.mjs` writes `packages/core/packs/sre.json` and, for each provider, `packages/pack-<name>/`:
`pack.json`, a `LICENSE` with the provider's terms and what the build changed, and a `README.md`. It reads the AWS
set from `node_modules/aws-icons`, downloads the Azure and Google zips once into `tools/packs/cache/`, and
normalises every SVG: XML declaration, comments and titles dropped; `<style>` class rules inlined as style
attributes (the sets reuse class names across icons); ids that nothing references dropped and the rest prefixed
with the kind's name (gradients, clip paths); `xlink:href` rewritten as `href`; markup with script, foreignObject,
image or an event handler refused. Nothing is cropped, flipped, rotated or recoloured. The result is a
`{ "viewBox", "svg" }` glyph the renderer draws as a nested `<svg>` in the box's glyph slot, 20×20.
`node tools/packs/build.mjs --manifests` rewrites the LICENSE and README files from the committed packs.

Names: an AWS file `AmazonSimpleStorageService` becomes `simple-storage-service` with the description "Amazon
Simple Storage Service"; Azure `10130-icon-service-SQL-Database` becomes `sql-database`; Google `cloud_sql`
becomes `cloud-sql`. The alias tables in the script add `s3`, `lambda`, `ec2`, `rds`, `dynamodb`, `sqs`, `sns`,
`eks`, `ecs`, `cloudfront`, `run`, `gke`, `cloudsql`, `pubsub`, `aks`, `cosmos`, `functions`, `app-service`,
`blob`, `service-bus`, `key-vault` and the rest; an alias is the same kind under a second name.

The generated files are committed. Re-run the script to pick up a new icon release, and read the diff. The pack
packages share the workspace version and are published by the release workflow like every other package.
