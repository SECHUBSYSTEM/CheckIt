import { basename, join, resolve } from "node:path";

export function monorepoRoot(): string {
  if (process.env.REPO_ROOT) {
    return resolve(process.env.REPO_ROOT);
  }
  const cwd = process.cwd();
  const leaf = basename(cwd);
  if (leaf === "user-service" || leaf === "wallet-service") {
    return join(cwd, "..", "..");
  }
  return cwd;
}

export function protoBaseDir(): string {
  return join(monorepoRoot(), "packages", "proto", "proto");
}
