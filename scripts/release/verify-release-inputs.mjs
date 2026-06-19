import { handleReleaseError, validateReleaseConfig } from "./release-utils.mjs";

async function main() {
  const publishRequired = process.argv.includes("--publish-required");
  const config = await validateReleaseConfig({ publishRequired });

  console.log(
    `Release input verification passed: mode=${config.mode}, version=${config.version}, npmTag=${config.npmTag}.`,
  );
}

main().catch(handleReleaseError);
