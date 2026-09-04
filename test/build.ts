import { execFileSync } from "node:child_process";
/** CLI e2e tests exercise the built artifact, so compile before the run. */
export default function setup() {
  execFileSync("yarn", ["build"], { stdio: "inherit" });
}
