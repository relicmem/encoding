import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  PACKAGE_ROOT,
  appendGitHubOutput,
  assertReleaseCondition,
  handleReleaseError,
  runNpm,
  validatePackagePreview,
  validateReleaseConfig,
} from "./release-utils.mjs";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const config = await validateReleaseConfig();

  const npmArgs = ["pack", "--json"];
  let packDestination;

  if (options.dryRun) {
    npmArgs.push("--dry-run");
  } else {
    packDestination = path.resolve(PACKAGE_ROOT, options.packDestination);
    await mkdir(packDestination, { recursive: true });
    npmArgs.push("--pack-destination", packDestination);
  }

  const { stdout } = await runNpm(npmArgs, { cwd: PACKAGE_ROOT });
  const packuments = parsePackOutput(stdout);
  assertReleaseCondition(packuments.length === 1, "npm pack must produce exactly one package.");

  const [packument] = packuments;
  validatePackagePreview(config.metadata, packument);

  console.log(
    `Package ${packument.name}@${packument.version} preview verified with ${packument.files.length} packed files.`,
  );

  if (packDestination) {
    const tarballPath = path.join(packDestination, path.basename(packument.filename));
    await appendGitHubOutput("tarball_path", tarballPath);
    await appendGitHubOutput("tarball_name", path.basename(tarballPath));
    console.log(`Package tarball created: ${tarballPath}`);
  }
}

function parseOptions(args) {
  const options = {
    dryRun: false,
    packDestination: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--pack-destination") {
      const value = args[index + 1];
      assertReleaseCondition(Boolean(value), "--pack-destination requires a directory.");
      options.packDestination = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option ${arg}.`);
  }

  assertReleaseCondition(
    options.dryRun !== Boolean(options.packDestination),
    "Use exactly one of --dry-run or --pack-destination.",
  );

  return options;
}

function parsePackOutput(stdout) {
  try {
    return JSON.parse(stdout.trim());
  } catch (error) {
    throw new Error(
      `Failed to parse npm pack JSON output: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

main().catch(handleReleaseError);
