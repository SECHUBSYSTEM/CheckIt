/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/../tsconfig.json",
        diagnostics: { ignoreCodes: [151002] },
      },
    ],
  },
  collectCoverageFrom: [
    "**/*.(t|j)s",
    "!**/*.spec.ts",
    "!**/main.ts",
    "!**/*.module.ts",
  ],
  coverageDirectory: "../coverage",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@packages/proto$": "<rootDir>/../../../packages/proto/src/index.ts",
    "^@packages/prisma-wallet$": "<rootDir>/../../../packages/prisma-wallet/src/index.ts",
  },
};
