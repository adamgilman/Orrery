import { execFileSync } from "node:child_process";
/** CLI and bundle tests exercise built artifacts, so compile before the run. ORRERY_SKIP_BUILD=1 runs source-only suites. */
export default function setup() {
  if (process.env.ORRERY_SKIP_BUILD) return;
  execFileSync("yarn", ["build"], { stdio: "inherit" });
}
