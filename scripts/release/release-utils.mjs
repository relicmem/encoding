import { appendFile, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "@rmem/encoding";
export const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const NPM_TAG_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;

const REQUIRED_PACKAGE_PATHS = Object.freeze([
  "README.md",
  "dist/index.d.ts",
  "dist/index.js",
  "package.json",
]);

const PROHIBITED_PACKAGE_ROOTS = Object.freeze([
  ".github/",
  ".npm-cache/",
  "coverage/",
  "docs/",
  "documentation/",
  "fixtures/",
  "node_modules/",
  "scripts/",
  "src/",
  "tests/",
]);

const PROHIBITED_PACKAGE_FILES = Object.freeze([
  ".editorconfig",
  ".gitignore",
  ".prettierignore",
  ".prettierrc.json",
  "AGENTS.md",
  "eslint.config.js",
  "package-lock.json",
  "tsconfig.build.json",
  "tsconfig.json",
]);

export class ReleaseAutomationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseAutomationError";
  }
}

export function assertReleaseCondition(condition, message) {
  if (!condition) {
    throw new ReleaseAutomationError(message);
  }
}

export async function readPackageMetadata() {
  const packageJson = await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8");
  return JSON.parse(packageJson);
}

export async function validateReleaseConfig(options = {}) {
  const metadata = await readPackageMetadata();
  const mode = process.env.RELEASE_MODE ?? "preview";
  const version = process.env.RELEASE_VERSION ?? metadata.version;
  const npmTag = process.env.NPM_TAG ?? "latest";

  assertReleaseCondition(metadata.name === PACKAGE_NAME, `Expected package name ${PACKAGE_NAME}.`);
  assertReleaseCondition(
    mode === "preview" || mode === "publish",
    "RELEASE_MODE must be preview or publish.",
  );
  assertReleaseCondition(
    SEMVER_PATTERN.test(version),
    "RELEASE_VERSION must be a valid semver version.",
  );
  assertReleaseCondition(
    version === metadata.version,
    `RELEASE_VERSION ${version} must match package.json version ${metadata.version}.`,
  );
  assertReleaseCondition(
    NPM_TAG_PATTERN.test(npmTag),
    "NPM_TAG must be a conservative npm dist-tag.",
  );
  assertReleaseCondition(!SEMVER_PATTERN.test(npmTag), "NPM_TAG must not be a semver version.");

  if (options.publishRequired) {
    assertReleaseCondition(mode === "publish", "Publishing requires RELEASE_MODE=publish.");
    assertReleaseCondition(
      Boolean(process.env.NODE_AUTH_TOKEN ?? process.env.NPM_TOKEN),
      "Publishing requires NODE_AUTH_TOKEN or NPM_TOKEN.",
    );
  }

  if (mode === "publish") {
    assertReleaseCondition(
      version !== "0.0.0",
      "Publishing the placeholder version 0.0.0 is not allowed.",
    );
    assertReleaseCondition(
      !version.includes("-") || npmTag !== "latest",
      "Prerelease versions must not be published with the latest npm dist-tag.",
    );

    const eventName = process.env.GITHUB_EVENT_NAME;
    assertReleaseCondition(
      !eventName || eventName === "workflow_dispatch",
      "Publish mode must run from a workflow_dispatch event.",
    );

    const refName = process.env.GITHUB_REF_NAME;
    const defaultBranch = process.env.RELEASE_DEFAULT_BRANCH ?? process.env.GITHUB_DEFAULT_BRANCH;
    assertReleaseCondition(
      !refName || !defaultBranch || refName === defaultBranch,
      `Publish mode must run from the default branch (${defaultBranch}).`,
    );
  }

  return {
    metadata,
    mode,
    npmTag,
    tagName: `v${version}`,
    version,
  };
}

export function validatePackagePreview(metadata, packument) {
  assertReleaseCondition(
    packument.name === metadata.name,
    "Packed package name does not match package.json.",
  );
  assertReleaseCondition(
    packument.version === metadata.version,
    "Packed package version does not match package.json.",
  );
  assertReleaseCondition(
    Array.isArray(packument.files),
    "npm pack output does not contain a files list.",
  );

  const packedPaths = new Set(packument.files.map((file) => normalizePackagePath(file.path)));

  for (const requiredPath of REQUIRED_PACKAGE_PATHS) {
    assertReleaseCondition(
      packedPaths.has(requiredPath),
      `Packed package is missing ${requiredPath}.`,
    );
  }

  for (const packedPath of packedPaths) {
    for (const prohibitedRoot of PROHIBITED_PACKAGE_ROOTS) {
      assertReleaseCondition(
        !packedPath.startsWith(prohibitedRoot),
        `Packed package unexpectedly includes ${packedPath}.`,
      );
    }

    assertReleaseCondition(
      !PROHIBITED_PACKAGE_FILES.includes(packedPath),
      `Packed package unexpectedly includes ${packedPath}.`,
    );
  }
}

export async function runNpm(args, options = {}) {
  return runCommand(npmCommand(), args, {
    ...options,
    env: withLocalNpmCache(options.env ?? process.env),
  });
}

export async function runCommand(command, args, options = {}) {
  const stdio = options.stdio ?? "pipe";

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? PACKAGE_ROOT,
      env: options.env ?? process.env,
      shell: options.shell ?? needsWindowsCommandShell(command),
      stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    if (stdio !== "inherit") {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stderr, stdout });
        return;
      }

      const renderedCommand = [command, ...args].join(" ");
      const detail = stderr.trim() || stdout.trim();
      reject(
        new ReleaseAutomationError(
          detail.length > 0
            ? `${renderedCommand} failed with exit code ${code}: ${detail}`
            : `${renderedCommand} failed.`,
        ),
      );
    });
  });
}

export async function appendGitHubOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, "utf8");
}

export function handleReleaseError(error) {
  if (error instanceof ReleaseAutomationError) {
    console.error(`Release automation error: ${error.message}`);
    process.exit(1);
  }

  throw error;
}

function normalizePackagePath(packagePath) {
  return String(packagePath).replaceAll("\\", "/");
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function needsWindowsCommandShell(command) {
  return process.platform === "win32" && /\.(?:bat|cmd)$/i.test(command);
}

function withLocalNpmCache(env) {
  const nextEnv = Object.fromEntries(
    Object.entries(env).filter(([key]) => key.toLowerCase() !== "npm_config_cache"),
  );

  return {
    ...nextEnv,
    npm_config_cache: env.RELEASE_NPM_CACHE ?? path.join(PACKAGE_ROOT, ".npm-cache"),
  };
}
