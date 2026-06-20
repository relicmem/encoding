import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import * as packageRoot from "../src/index.js";

interface PackageMetadata {
  readonly name: string;
  readonly main?: string;
  readonly types?: string;
  readonly files?: readonly string[];
  readonly exports?: unknown;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

const PUBLIC_RUNTIME_EXPORTS = Object.freeze([
  "BUILT_IN_ENCODING_PROFILES",
  "ENCODING_DIAGNOSTIC_CODES",
  "EncodingError",
  "RELICMEM_ENCODING_NAMES",
  "aliasesForEncoding",
  "createDecodingStream",
  "createEncodingError",
  "createEncodingWarning",
  "decodeDocument",
  "decodeDocumentSync",
  "detectEncoding",
  "encodingFailure",
  "encodingSuccess",
  "freezeEncodingWarnings",
  "isEncodingError",
  "isRelicMEMEncodingName",
  "mergeEncodingWarnings",
  "normalizeEncodingLabel",
  "tryDecodeDocument",
  "tryNormalizeEncodingLabel",
]);

const INTERNAL_RUNTIME_EXPORTS = Object.freeze([
  "BUILT_IN_ENCODING_PROFILE_POLICIES",
  "DecoderRegistry",
  "DetectionSampler",
  "NATIVE_UNICODE_BACKEND",
  "createDecoderRegistry",
  "createDetectionSampler",
  "createIconvLiteBackend",
  "createLineIndex",
  "createNativeUnicodeBackend",
  "createOffsetMap",
  "createSourceBuffer",
  "createTextDecoderBackend",
  "detectByteOrderMark",
  "detectCompositeEncoding",
  "detectLegacyEncoding",
  "detectUtf16",
  "isTextDecoderBackendAvailable",
  "normalizeDecodeDocumentOptions",
  "normalizeEncodingInput",
  "resolveEncodingProfilePolicy",
  "validateUtf8",
]);

describe("package release readiness", () => {
  it("keeps the package root runtime export boundary explicit", () => {
    expect(Object.keys(packageRoot).sort()).toEqual([...PUBLIC_RUNTIME_EXPORTS].sort());

    for (const internalExport of INTERNAL_RUNTIME_EXPORTS) {
      expect(packageRoot).not.toHaveProperty(internalExport);
    }
  });

  it("publishes only the built package entrypoint and type declarations", async () => {
    const metadata = await readPackageMetadata();

    expect(metadata.name).toBe("@relicmem/encoding");
    expect(metadata.files).toEqual(["dist"]);
    expect(metadata.main).toBe("./dist/index.js");
    expect(metadata.types).toBe("./dist/index.d.ts");
    expect(metadata.exports).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
    });
  });

  it("keeps runtime and optional backend dependencies out of the v1 package footprint", async () => {
    const metadata = await readPackageMetadata();

    expect(metadata.dependencies ?? {}).toEqual({});
    expect(metadata.optionalDependencies ?? {}).toEqual({});
  });
});

async function readPackageMetadata(): Promise<PackageMetadata> {
  const rawJson = await readFile(new URL("../package.json", import.meta.url), "utf8");

  return JSON.parse(rawJson) as PackageMetadata;
}
