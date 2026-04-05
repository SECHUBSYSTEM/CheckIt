import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { getDatabaseUrls } from "./load-database-env.mjs";

const { root, userUrl, walletUrl } = getDatabaseUrls({
  warnIfUsingDefaults: false,
});

function runGenerate(packageDir, databaseUrl) {
  execSync("pnpm exec prisma generate", {
    cwd: resolve(root, packageDir),
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
    shell: true,
  });
}

runGenerate("packages/prisma-user", userUrl);
runGenerate("packages/prisma-wallet", walletUrl);
