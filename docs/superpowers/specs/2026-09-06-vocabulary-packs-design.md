# Vocabulary packs

Date: 2026-09-06. Status: built 2026-09-06. PRD item N3.

## The idea

A pack is a vocabulary shipped with the tool: kinds bound to glyphs and frames, or states bound to looks. A model
pulls one in by name and then overrides, extends or ignores it exactly as it does the defaults today.

```jsonc
"kinds":  { "use": ["aws"] },
"states": { "use": "sre" }
```

Three cloud packs carry the providers' own icons, in full colour: `aws` (AWS Architecture Icons), `gcp` (Google
Cloud product icons) and `azure` (Azure Public Service Icons). One states pack, `sre`, carries the vocabulary the
README's stage 7 uses: healthy, impaired, brownout, outage, drained.

Nothing in the engine learns a provider. A pack is data merged into the model before validation continues; the
renderer draws a kind's glyph as it always has.

## Model

### `use`

`kinds.use` and `states.use` take a pack name or a list of names. Order matters: later packs win over earlier ones.
The author's own definitions win over every pack. `replace: true` drops the defaults and keeps the packs the author
asked for. An unknown pack is an error at `/kinds/use/0` naming the packs that exist.

### Kind names

A pack's kinds are namespaced: `aws:s3`, `gcp:cloud-run`, `azure:sql-database`. The kind name pattern gains one
optional `:` segment. Authors may namespace their own kinds too. In the SVG the name is the class as written;
the stylesheet escapes the colon.

### Glyph object

A glyph today is a preset name or SVG path data in a 16×16 box, drawn with the theme's stroke. A pack glyph is an
icon with its own colours:

```jsonc
"glyph": { "viewBox": "0 0 64 64", "svg": "<path fill=\"#7aa116\" d=\"…\"/>…" }
```

The renderer draws it as a nested `<svg>` in the glyph slot, so the icon's coordinate space is its own and nothing
in it needs renaming. Icons are 20×20 in the slot; stroke glyphs stay 16×16. Validation rejects a glyph whose
markup contains `<script`, `<foreignObject`, `<image` or an `on*=` handler, and requires both fields.

### Pack file

`packages/core/packs/<name>.json`:

```jsonc
{
  "name": "aws",
  "title": "AWS Architecture Icons",
  "version": "01/30/2026",
  "source": "https://aws.amazon.com/architecture/icons/",
  "terms": "…the provider's terms, verbatim…",
  "kinds": { "components": { "s3": { "glyph": {…}, "description": "Amazon Simple Storage Service (S3)" }, … },
             "groups":     { "vpc": { "frame": { "stroke": "#8c4fff", "dash": true }, "description": "Virtual private cloud" }, … } },
  "states": { "define": { … }, "default": "healthy" }
}
```

Names inside a pack are unqualified; the loader prefixes them with `<name>:`. A states pack is not prefixed:
state names are the author's words and `sre:healthy` would read badly in a legend.

### Names in the cloud packs

Every icon in a provider's set becomes a kind, with a name derived from the provider's file name: `AmazonSimpleStorageService` → `simple-storage-service`,
`10130-icon-service-SQL-Database` → `sql-database`, `cloud_sql` → `cloud-sql`. A curated alias table adds the
names people say: `s3`, `lambda`, `ec2`, `rds`, `dynamodb`, `sqs`, `sns`, `eks`, `cloud-run` as `run`,
`gke`, `cloudsql`, `pubsub`, `aks`, `cosmos`, `functions`, `app-service`, `blob`, `service-bus`, `key-vault`.
An alias is the same kind under a second name. Descriptions are the service's full name, so a reader hovering a
box sees "Amazon Simple Storage Service (S3)".

Each cloud pack also defines a few group kinds as frames in the provider's colours: AWS cloud, region,
availability zone, VPC, public and private subnet; Google Cloud project, region, zone, VPC; Azure subscription,
resource group, region, virtual network, subnet.

### `orrery packs`

`orrery packs` lists the packs with their titles and terms. `orrery packs aws` lists every kind name with its
description, so an agent can find `aws:simple-storage-service` without opening the file.

## Sources and terms

| Pack | Source | Form | Terms |
|---|---|---|---|
| aws | AWS Architecture Icons, 01/30/2026, via the `aws-icons` npm package (MIT wrapper of the official set) | 300 service icons, 64×64, coloured square | AWS: customers and partners may use them in architecture diagrams |
| gcp | Google Cloud product icons, the current core set and the full legacy set from cloud.google.com/icons | 45 + 216 icons, 512 and 24 px | Offered on the icons page for architecture diagrams; no separate licence text is published with the download |
| azure | Azure Public Service Icons V24 from learn.microsoft.com | 714 icons, 18×18, gradients | "Microsoft permits the use of these icons in architectural diagrams, training materials, or documentation. You can copy, distribute, and display the icons only for the permitted use unless granted explicit permission by Microsoft. Microsoft reserves all other rights." |

Each pack's `terms` field carries the provider's text verbatim, and `docs/PACKS.md` repeats it with the version
and the date the set was fetched. The packs are for drawing architecture diagrams, which is the permitted use.

## Build

`tools/packs/build.mjs` writes the four pack files. It downloads the Azure and Google zips into a cache
directory, reads the AWS set from `node_modules/aws-icons`, normalises each SVG and writes the JSON. Normalising:
drop the XML declaration, comments and `<title>`; drop the root's `width`, `height` and `id`; inline `<style>`
class rules as attributes (Google's icons carry `.st0{fill:…}` rules that would collide across icons); keep the
`viewBox`; keep the rest as written. The alias and group tables live in the script. The generated files are
committed, so the tool has no build-time network dependency and a change to a pack shows in a diff.

## Rendering

`componentBody` draws an object glyph as `<svg class="icon" x y width="20" height="20" viewBox="…">…</svg>`.
Measurement is unchanged: the glyph slot is already 24 wide. Tour variants reuse `componentBody`, so a state
variant of a node carries its icon too. The raster and runtime do not touch glyphs.

## Tests

- Pack files parse, every kind name matches the pattern, every glyph passes the glyph check, aliases resolve.
- A model with `"kinds": { "use": ["aws"] }` and a component of kind `aws:s3` renders the S3 icon (a nested
  `<svg class="icon">` inside the node) and the class is escaped in the stylesheet.
- Overriding `aws:s3` in the author's `kinds.components` wins over the pack; `replace: true` keeps the pack.
- `states.use: "sre"` gives the five states; the author's `define` merges onto them.
- Unknown pack, bad glyph object, script in a glyph: errors with pointers.
- CLI: `packs` lists, `packs aws` lists kinds, `render` of a pack model is byte-deterministic.

## Docs

MODEL.md 4.8 gains the glyph object and a "Packs" paragraph; a new invariant R13 says how packs merge. README gets
one stage more: "8. On a cloud", the checkout drawn with AWS icons, and a pointer to PACKS.md. PRD moves N3 to
Done. The schema descriptions say the same in the same words.

## Not in this slice

Monochrome icons, provider group icons as glyphs on frames, packs from outside the tool (a `use` of a path or
URL), and the Microsoft 365, Entra, Fabric and Power Platform sets.

## Amendments while building

- **A states pack stands in for the defaults.** `states.use` without `replace` would otherwise give nine states,
  two of them meaning healthy. A vocabulary is whole, so a states pack replaces the defaults the way `replace: true`
  does, and `define` merges onto it. Kinds packs still add to the defaults: their names are prefixed and coexist.
- **An unknown pack keeps the defaults.** So the one error is the unknown pack, not a cascade of unknown states.
- **The listing is sectioned** (`states`, `kinds.components`, `kinds.groups`) because `aws:vpc` is both a component
  (the VPC service icon) and a group frame.
- **Sources as built:** AWS from the `aws-icons` npm package (the official set, 01/30/2026); Azure V24; Google's
  legacy set (216) plus the current core products set (19), the core drawing winning where both have a product.
- **The README runs on the pack (user, 2026-09-06).** Rather than a separate stage 8, the master checkout model
  declares `"kinds": { "use": ["aws"] }`, so every stage picture and the landing page carry the AWS icons from the
  first picture on; stage 1's text introduces packs.
