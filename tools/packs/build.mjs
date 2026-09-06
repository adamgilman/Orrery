// Writes the vocabulary packs in packages/core/packs/ (docs/PACKS.md): aws, azure and gcp from the providers'
// own icon sets, and sre, a states vocabulary. Usage: node tools/packs/build.mjs
// The Azure and Google zips are downloaded once into tools/packs/cache/ (unzip must be on the PATH); the AWS set
// comes from the aws-icons npm package, an MIT-licensed wrapper of the official asset package. The generated files
// are committed, so a change to a set shows in a diff and the tool has no build-time network dependency.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const CACHE = "tools/packs/cache";
const OUT = "packages/core/packs";
const FETCHED = "2026-09-06";

async function unzipped(name, url) {
  const zip = join(CACHE, `${name}.zip`);
  mkdirSync(CACHE, { recursive: true });
  if (!existsSync(zip)) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  }
  const dir = join(CACHE, name);
  if (!existsSync(dir)) execFileSync("unzip", ["-qo", zip, "-d", dir]);
  return dir;
}
function svgFiles(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === "__MACOSX") continue;
    if (statSync(p).isDirectory()) out.push(...svgFiles(p));
    else if (f.endsWith(".svg")) out.push(p);
  }
  return out.sort();
}

/* ---------- normalising one icon ---------- */
/** Parse `<style>` rules into class → declarations. The sets only use class selectors; anything else is a build error. */
function classRules(css) {
  const rules = new Map();
  for (const [, selectors, decls] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const s of selectors.split(",").map((x) => x.trim()).filter(Boolean)) {
      const m = s.match(/^\.([\w-]+)$/);
      if (!m) throw new Error(`unsupported selector in icon style: ${s}`);
      rules.set(m[1], [...(rules.get(m[1]) ?? []), ...decls.split(";").map((d) => d.trim()).filter(Boolean)]);
    }
  }
  return rules;
}
/** { viewBox, svg }: the icon's drawing with nothing that could collide or misbehave inside another document. */
function normalise(text, prefix) {
  let t = text.replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/g, "").replace(/<(title|desc|metadata)\b[^>]*>[\s\S]*?<\/\1>/g, "");
  const root = t.match(/<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/);
  if (!root) throw new Error("not an svg");
  const attr = (s, name) => s.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  const viewBox = attr(root[1], "viewBox") ?? `0 0 ${parseFloat(attr(root[1], "width"))} ${parseFloat(attr(root[1], "height"))}`;
  let body = root[2];
  // styles → style attributes
  const rules = new Map();
  body = body.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/g, (_, css) => { for (const [k, v] of classRules(css)) rules.set(k, [...(rules.get(k) ?? []), ...v]); return ""; });
  body = body.replace(/<defs>\s*<\/defs>/g, "");
  body = body.replace(/<([a-zA-Z]+)([^>]*?)(\/?)>/g, (_, tag, attrs, close) => {
    attrs = attrs.replace(/\s(data-name|enable-background|xml:space)="[^"]*"/g, "").replace(/\sxlink:href=/g, " href=");
    const cls = attrs.match(/\sclass="([^"]*)"/);
    if (cls) {
      const decls = cls[1].split(/\s+/).flatMap((c) => rules.get(c) ?? []);
      attrs = attrs.replace(cls[0], "");
      if (decls.length) {
        const own = attrs.match(/\sstyle="([^"]*)"/);
        attrs = own ? attrs.replace(own[0], ` style="${[...decls, own[1]].join(";")}"`) : `${attrs} style="${decls.join(";")}"`;
      }
    }
    return `<${tag}${attrs}${close}>`;
  });
  // ids: keep and prefix the referenced ones, drop the rest
  const referenced = new Set([...body.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map((m) => m[1] ?? m[2]));
  body = body.replace(/\sid="([^"]*)"/g, (_, id) => (referenced.has(id) ? ` id="${prefix}-${id}"` : ""));
  body = body.replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${prefix}-${id})`).replace(/href="#([^"]+)"/g, (_, id) => `href="#${prefix}-${id}"`);
  body = body.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
  if (/<\s*(script|foreignObject|image|style|iframe)\b|\bon[a-z]+\s*=|href="(?!#)/i.test(body)) throw new Error(`unsafe markup in ${prefix}`);
  return { viewBox, svg: body };
}

/* ---------- names ---------- */
/** Compound names the providers write as one word; the split-by-capitals pass undoes them and this puts them back. */
const JOINED = ["DynamoDB", "DocumentDB", "MemoryDB", "AlloyDB", "IoT", "ElastiCache", "CloudFront", "CloudWatch", "CloudTrail", "CloudFormation", "CloudHSM", "CloudSearch", "CloudShell", "SageMaker", "AppSync", "AppFlow", "AppConfig", "AppStream", "EventBridge", "OpenSearch", "BigQuery", "SecOps", "GuardDuty", "HealthLake", "DataSync", "DataZone", "PrivateLink", "CodeBuild", "CodePipeline", "CodeCommit", "CodeDeploy", "CodeArtifact", "CodeCatalyst", "CodeGuru", "CodeWhisperer", "FinSpace", "QuickSight", "QuickSuite", "GameLift", "WorkSpaces", "WorkDocs", "WorkMail", "FSx", "MediaConvert", "MediaLive", "MediaPackage", "MediaStore", "MediaTailor", "MediaConnect", "AMIs", "SDKs", "APIs", "SiteWise", "FleetWise", "TwinMaker", "ExpressLink", "DeepRacer", "SimSpace", "Timestream", "Lightsail", "Wavelength", "OpenShift", "VMware", "HealthOmics", "HealthScribe", "HealthImaging", "DevOps", "CloudWAN", "Bottlerocket", "FreeRTOS", "MXNet", "PyTorch", "TensorFlow", "Corretto", "OpenZFS", "NetApp", "ONTAP", "rePost", "XRay"];
/** AWS file names glue a lowercase joining word to the word before it: "IdentityandAccess", "FSxforLustre", "S3onOutposts". */
const GLUED = /(Identity|Cost|Tools)(and)(?=[A-Z])|(Distro|Lookout|Lightsail|Sx|Streaming|Service|Workflows)(for)(?=[A-Z])|(Database)(at)(?=[A-Z])|(Site)(to)(?=[A-Z])|(S3|Net|Torch|Flow|Service)(on)(?=[A-Z])/g;
/** Split at capitals and at glued joining words: "IdentityandAccess" → "Identity and Access". */
const split = (s) => s.replace(GLUED, (m, ...g) => { const [a, w] = g.filter((x) => typeof x === "string"); return `${a} ${w}`; }).replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2").replace(/_/g, " ");
const REJOIN = JOINED.map((w) => [new RegExp(`\\b${split(w).replace(/ /g, "\\s?")}\\b`, "g"), w === "XRay" ? "X-Ray" : w]);
/** "SimpleStorageService" → "Simple Storage Service"; "IoTCore" → "IoT Core". */
function words(camel) {
  let s = split(camel);
  for (const [re, w] of REJOIN) s = s.replace(re, w);
  return s.replace(/\s+/g, " ").trim();
}
/** "AmazonSimpleStorageService" → "Amazon Simple Storage Service"; the brand prefix is split off first so it never glues to the name. */
function awsWords(stem) {
  const brand = stem.match(/^(Amazon|AWS)(?=.)/)?.[0];
  return brand ? `${brand} ${words(stem.slice(brand.length))}` : words(stem);
}
const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const UPPER = new Set(["sql", "api", "apis", "gke", "iam", "ai", "ml", "cdn", "dns", "nat", "vpn", "gpu", "tpu", "hsm", "ekm", "ids", "os", "vpc", "ssd", "vm", "id", "cx", "hub", "nlp", "ip", "gce", "kms", "iot", "sdk", "cli", "ui", "aws", "gcp", "hpc", "grpc", "dlp", "vmware", "secops", "secops"]);
/** "cloud_sql" → "Cloud SQL"; "identity-aware_proxy" → "Identity-Aware Proxy". */
const titleCase = (s) => s.split(/[_\s]+/).map((w) => w.split("-").map((p) => (UPPER.has(p) ? p.toUpperCase() : p === "pubsub" ? "Pub/Sub" : p === "bigquery" ? "BigQuery" : p === "bigtable" ? "Bigtable" : p === "vmware" ? "VMware" : p.charAt(0).toUpperCase() + p.slice(1))).join("-")).join(" ");

/* ---------- the packs ---------- */
function components(files, nameOf, descriptionOf, packName) {
  const out = {};
  for (const f of files) {
    const stem = basename(f, ".svg");
    const desc = descriptionOf(stem);
    const name = nameOf(stem, desc);
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) throw new Error(`bad kind name ${name} from ${f}`);
    out[name] = { glyph: normalise(readFileSync(f, "utf8"), `${packName}-${name}`), description: desc };
  }
  return out;
}
function alias(components, aliases, packName) {
  for (const [a, target] of Object.entries(aliases)) {
    if (!components[target]) throw new Error(`${packName}: alias ${a} → ${target}, which does not exist`);
    if (components[a] && components[a] !== components[target]) throw new Error(`${packName}: alias ${a} would hide a kind`);
    components[a] = components[target];
  }
}
const frame = (stroke, extra = {}, description) => ({ frame: { stroke, ...extra }, description });

const AWS_ALIASES = { s3: "simple-storage-service", glacier: "simple-storage-service-glacier", sqs: "simple-queue-service", sns: "simple-notification-service", ses: "simple-email-service", eks: "elastic-kubernetes-service", ecs: "elastic-container-service", ecr: "elastic-container-registry", ebs: "elastic-block-store", elb: "elastic-load-balancing", alb: "elastic-load-balancing", nlb: "elastic-load-balancing", route53: "route-53", redis: "elasticache", iam: "identity-and-access-management", kms: "key-management-service", msk: "managed-streaming-for-apache-kafka", kafka: "managed-streaming-for-apache-kafka", opensearch: "opensearch-service", vpc: "virtual-private-cloud", firehose: "data-firehose", cdk: "cloud-development-kit", cloud9: "cloud-9", xray: "x-ray", dms: "database-migration-service", acm: "certificate-manager", sso: "iam-identity-center", stepfunctions: "step-functions", eventbridge: "eventbridge", apigateway: "api-gateway", cloudfront: "cloudfront", cloudwatch: "cloudwatch", dynamodb: "dynamodb", lambda: "lambda", ec2: "ec2", rds: "rds", aurora: "aurora", fargate: "fargate", cognito: "cognito", kinesis: "kinesis", athena: "athena", glue: "glue", redshift: "redshift", bedrock: "bedrock", sagemaker: "sagemaker", mq: "mq", waf: "waf", shield: "shield", efs: "efs", emr: "emr", batch: "batch", amplify: "amplify", appsync: "appsync", backup: "backup", neptune: "neptune", timestream: "timestream", keyspaces: "keyspaces", documentdb: "documentdb", memorydb: "memorydb" };
const GCP_ALIASES = { run: "cloud-run", cloudrun: "cloud-run", cloudsql: "cloud-sql", sql: "cloud-sql", gcs: "cloud-storage", storage: "cloud-storage", functions: "cloud-functions", gce: "compute-engine", spanner: "cloud-spanner", lb: "cloud-load-balancing", cdn: "cloud-cdn", armor: "cloud-armor", iam: "identity-and-access-management", kms: "key-management-service", nat: "cloud-nat", dns: "cloud-dns", scheduler: "cloud-scheduler", tasks: "cloud-tasks", build: "cloud-build", logging: "cloud-logging", monitoring: "cloud-monitoring", interconnect: "cloud-interconnect", vpn: "cloud-vpn", endpoints: "cloud-endpoints", iap: "identity-aware-proxy", kubernetes: "gke", registry: "artifact-registry", "secret-manager": "secret-manager", "app-engine": "app-engine", vpc: "virtual-private-cloud", "iot-core": "iot-core", workflows: "workflows", datastore: "datastore", composer: "cloud-composer", "api-gateway": "cloud-api-gateway", vertex: "vertex-ai", pubsub: "pubsub", gke: "gke", bigquery: "bigquery", bigtable: "bigtable", firestore: "firestore", memorystore: "memorystore", dataflow: "dataflow", dataproc: "dataproc", apigee: "apigee", alloydb: "alloydb", looker: "looker", filestore: "filestore", eventarc: "eventarc" };
const AZURE_ALIASES = { aks: "kubernetes-services", cosmos: "azure-cosmos-db", cosmosdb: "azure-cosmos-db", functions: "function-apps", "app-service": "app-services", blob: "storage-accounts", storage: "storage-accounts", "service-bus": "azure-service-bus", "key-vault": "key-vaults", keyvault: "key-vaults", vm: "virtual-machine", vms: "virtual-machine", vmss: "vm-scale-sets", sql: "sql-database", "sql-server": "sql-server", redis: "cache-redis", postgres: "azure-database-postgresql-server", postgresql: "azure-database-postgresql-server", mysql: "azure-database-mysql-server", "event-hubs": "event-hubs", "event-grid": "event-grid-topics", apim: "api-management-services", "api-management": "api-management-services", aci: "container-instances", acr: "container-registries", "container-apps": "container-apps-environments", "app-gateway": "application-gateways", "front-door": "front-door-and-cdn-profiles", "load-balancer": "load-balancers", vnet: "virtual-networks", queue: "storage-queue", "file-shares": "storage-azure-files", "logic-apps": "logic-apps", openai: "azure-openai", monitor: "monitor", sentinel: "azure-sentinel", devops: "azure-devops", databricks: "azure-databricks", synapse: "azure-synapse-analytics", "data-factory": "data-factories", cdn: "cdn-profiles", dns: "dns-zones", firewall: "firewalls", waf: "web-application-firewall-policies-waf", bastion: "bastions", "spring-apps": "azure-spring-apps", "static-web-apps": "static-apps", signalr: "signalr", "iot-hub": "iot-hub", entra: "entra-id-protection", "managed-identity": "managed-identities", "private-endpoint": "private-endpoints", "log-analytics": "log-analytics-workspaces", "app-insights": "application-insights", "traffic-manager": "traffic-manager-profiles", "data-lake": "data-lake-storage-gen1", "data-explorer": "azure-data-explorer-clusters", "ml": "azure-machine-learning" };

async function aws() {
  const dir = "node_modules/aws-icons/icons/architecture-service";
  const version = readFileSync("node_modules/aws-icons/README.md", "utf8").match(/Version (\d\d\/\d\d\/\d{4})/)?.[1] ?? JSON.parse(readFileSync("node_modules/aws-icons/package.json", "utf8")).version;
  const c = components(svgFiles(dir), (stem, desc) => kebab(desc.replace(/^(Amazon|AWS) /, "")), awsWords, "aws");
  alias(c, AWS_ALIASES, "aws");
  return {
    name: "aws", title: "AWS Architecture Icons", version, source: "https://aws.amazon.com/architecture/icons/", fetched: FETCHED,
    terms: "AWS Architecture Icons are provided by Amazon Web Services for customers and partners to use in architecture diagrams. See the AWS Architecture Icons page and the asset package's terms of use.",
    kinds: {
      components: c,
      groups: {
        cloud: frame("#232f3e", {}, "AWS Cloud"), account: frame("#e7157b", {}, "AWS account"), region: frame("#00a4a6", { dash: true }, "Region"),
        "availability-zone": frame("#00a4a6", { dotted: true }, "Availability Zone"), vpc: frame("#8c4fff", { dash: true }, "Virtual private cloud (VPC)"),
        "public-subnet": frame("#7aa116", { fill: "#f2f6e8" }, "Public subnet"), "private-subnet": frame("#00a4a6", { fill: "#e6f6f7" }, "Private subnet"),
        "security-group": frame("#dd344c", { dash: true }, "Security group"), "auto-scaling-group": frame("#ed7100", { dash: true }, "Auto Scaling group"),
        "on-premises": frame("#5a6b86", { dash: true }, "Corporate data centre"),
      },
    },
  };
}
async function gcp() {
  const legacy = await unzipped("gcp-legacy", "https://services.google.com/fh/files/misc/google-cloud-legacy-icons.zip");
  const core = await unzipped("gcp-core", "https://services.google.com/fh/files/misc/core-products-icons.zip");
  const c = components(svgFiles(legacy), (stem) => kebab(stem), (stem) => titleCase(stem.replace(/_-_/g, " ")), "gcp");
  // the current core set wins over the legacy drawing of the same product
  Object.assign(c, components(svgFiles(core), (stem, desc) => kebab(desc), (stem) => words(stem.replace(/-512-color(-rgb)?$/, "")), "gcp"));
  alias(c, GCP_ALIASES, "gcp");
  return {
    name: "gcp", title: "Google Cloud product icons", version: `legacy set and core products set as published on ${FETCHED}`, source: "https://cloud.google.com/icons", fetched: FETCHED,
    terms: "Google Cloud offers these icons for building architecture diagrams. No separate licence text accompanies the download; see the Google Cloud icons page.",
    kinds: {
      components: c,
      groups: {
        project: frame("#4285f4", {}, "Project"), region: frame("#4285f4", { dash: true }, "Region"), zone: frame("#4285f4", { dotted: true }, "Zone"),
        vpc: frame("#34a853", { dash: true }, "VPC network"), subnet: frame("#34a853", { fill: "#e6f4ea" }, "Subnet"), cluster: frame("#4285f4", { fill: "#e8f0fe" }, "GKE cluster"),
        "on-premises": frame("#5f6368", { dash: true }, "On-premises"),
      },
    },
  };
}
async function azure() {
  const dir = await unzipped("azure", "https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V24.zip");
  const stemOf = (stem) => stem.replace(/^\d+\s*-icon-(service-)?/, "").trim();
  const c = components(svgFiles(dir), (stem, desc) => kebab(desc), (stem) => stemOf(stem).replace(/-/g, " ").replace(/\s+/g, " "), "azure");
  alias(c, AZURE_ALIASES, "azure");
  return {
    name: "azure", title: "Azure Public Service Icons", version: "V24", source: "https://learn.microsoft.com/en-us/azure/architecture/icons/", fetched: FETCHED,
    terms: "Microsoft permits the use of these icons in architectural diagrams, training materials, or documentation. You can copy, distribute, and display the icons only for the permitted use unless granted explicit permission by Microsoft. Microsoft reserves all other rights.",
    kinds: {
      components: c,
      groups: {
        subscription: frame("#0078d4", {}, "Subscription"), "resource-group": frame("#0078d4", { dash: true }, "Resource group"), region: frame("#0078d4", { dotted: true }, "Region"),
        "availability-zone": frame("#0078d4", { dotted: true }, "Availability zone"), vnet: frame("#008272", { dash: true }, "Virtual network"), subnet: frame("#008272", { fill: "#e5f4f2" }, "Subnet"),
        "on-premises": frame("#5c5c5c", { dash: true }, "On-premises"),
      },
    },
  };
}
const sre = () => ({
  name: "sre", title: "SRE states", version: "1", source: "Orrery", fetched: FETCHED, terms: "MIT, with the tool.",
  states: {
    default: "healthy",
    define: {
      healthy: { look: "normal", description: "Within SLO" },
      impaired: { look: "warn", description: "Serving; redundancy or latency SLO breached" },
      brownout: { look: { stroke: "#7c3aed", fill: "#f5f3ff", text: "#5b21b6", pulse: true }, description: "Serving with a feature switched off" },
      outage: { look: "alert", flows: "stop", description: "Customer-visible failure" },
      drained: { look: "muted", flows: "stop", description: "Deliberately out of rotation" },
    },
  },
});

mkdirSync(OUT, { recursive: true });
for (const pack of [await aws(), await azure(), await gcp(), sre()]) {
  const file = join(OUT, `${pack.name}.json`);
  writeFileSync(file, JSON.stringify(pack) + "\n");
  const n = Object.keys(pack.kinds?.components ?? {}).length || Object.keys(pack.states?.define ?? {}).length;
  console.log(`${file}: ${n} ${pack.kinds ? "kinds" : "states"}, ${(statSync(file).size / 1024).toFixed(0)} KB`);
}
