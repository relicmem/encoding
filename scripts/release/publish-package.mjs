import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  PACKAGE_ROOT,
  assertReleaseCondition,
  handleReleaseError,
  runNpm,
  validateReleaseConfig,
} from "./release-utils.mjs";

async function main() {
  const config = await validateReleaseConfig({ publishRequired: true });
  const releaseDirectory = path.resolve(PACKAGE_ROOT, process.argv[2] ?? ".release");
  const tarballPath = await findSingleTarball(releaseDirectory);
  const env = {
    ...process.env,
    NODE_AUTH_TOKEN: process.env.NODE_AUTH_TOKEN ?? process.env.NPM_TOKEN,
  };

  await runNpm(
    ["publish", tarballPath, "--access", "public", "--provenance", "--tag", config.npmTag],
    {
      cwd: PACKAGE_ROOT,
      env,
      stdio: "inherit",
    },
  );

  console.log(
    `Published ${config.metadata.name}@${config.version} with npm dist-tag ${config.npmTag}.`,
  );
}

async function findSingleTarball(releaseDirectory) {
  const entries = await readdir(releaseDirectory, { withFileTypes: true });
  const tarballs = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tgz"))
    .map((entry) => path.join(releaseDirectory, entry.name));

  assertReleaseCondition(
    tarballs.length === 1,
    `Expected exactly one .tgz package in ${releaseDirectory}.`,
  );
  return tarballs[0];
}

main().catch(handleReleaseError);
