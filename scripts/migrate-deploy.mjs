import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { getDatabaseUrls } from "./load-database-env.mjs";

const { root, userUrl, walletUrl } = getDatabaseUrls({
  warnIfUsingDefaults: true,
});

function runMigrateDeploy(packageDir, databaseUrl) {
  execSync("pnpm exec prisma migrate deploy", {
    cwd: resolve(root, packageDir),
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
    shell: true,
  });
}

runMigrateDeploy("packages/prisma-user", userUrl);
runMigrateDeploy("packages/prisma-wallet", walletUrl);
