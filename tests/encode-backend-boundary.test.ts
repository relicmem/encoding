import { readFile } from "node:fs/promises";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const FORBIDDEN_ENCODE_TEXT_IMPORTS = Object.freeze([
  "./DecodeDocumentCore.js",
  "./DecodeDocument.js",
  "./DecodeDocumentSync.js",
  "./TryDecodeDocument.js",
  "./stream/DecodingStream.js",
]);

describe("encode backend boundary", () => {
  it("keeps EncodeText independent from decode pipeline modules", async () => {
    const source = await readFile(new URL("../src/EncodeText.ts", import.meta.url), "utf8");
    const imports = collectImportSpecifiers("EncodeText.ts", source);

    expect(
      imports.filter((specifier) => FORBIDDEN_ENCODE_TEXT_IMPORTS.includes(specifier)),
    ).toEqual([]);
  });
});

function collectImportSpecifiers(fileName: string, source: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .map((statement) => statement.moduleSpecifier)
    .filter(ts.isStringLiteral)
    .map((moduleSpecifier) => moduleSpecifier.text);
}
