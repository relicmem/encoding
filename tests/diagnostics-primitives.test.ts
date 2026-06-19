import { describe, expect, it } from "vitest";

import {
  ENCODING_DIAGNOSTIC_CODES,
  EncodingError,
  createEncodingError,
  createEncodingWarning,
  encodingFailure,
  encodingSuccess,
  freezeEncodingWarnings,
  isEncodingError,
  mergeEncodingWarnings,
} from "../src/index.js";

describe("diagnostics primitives", () => {
  it("creates immutable warnings with structured ranges and details", () => {
    const details = { encoding: "utf-8", byte: 0xc3 };
    const warning = createEncodingWarning({
      code: "ENCODING_INVALID_SEQUENCE_REPLACED",
      message: "Invalid byte sequence was replaced.",
      byteRange: { start: 1, end: 2 },
      textRange: { start: 1, end: 2 },
      details,
    });

    details.encoding = "windows-1251";

    expect(warning).toEqual({
      code: "ENCODING_INVALID_SEQUENCE_REPLACED",
      severity: "warning",
      message: "Invalid byte sequence was replaced.",
      byteRange: { start: 1, end: 2 },
      textRange: { start: 1, end: 2 },
      details: { encoding: "utf-8", byte: 0xc3 },
    });
    expect(Object.isFrozen(warning)).toBe(true);
    expect(Object.isFrozen(warning.byteRange)).toBe(true);
    expect(Object.isFrozen(warning.textRange)).toBe(true);
    expect(Object.isFrozen(warning.details)).toBe(true);
  });

  it("creates EncodingError instances without losing accumulated diagnostics", () => {
    const warning = createEncodingWarning({
      code: "ENCODING_LOW_CONFIDENCE",
      severity: "info",
      message: "Detection confidence is below the configured threshold.",
    });
    const warnings = [warning];
    const error = createEncodingError({
      code: "ENCODING_INVALID_SEQUENCE",
      message: "Invalid byte sequence.",
      byteRange: { start: 3, end: 5 },
      details: { backend: "native" },
      warnings,
    });

    warnings.push(
      createEncodingWarning({
        code: "ENCODING_FALLBACK_USED",
        message: "Fallback encoding was used.",
      }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(EncodingError);
    expect(isEncodingError(error)).toBe(true);
    expect(error.name).toBe("EncodingError");
    expect(error.code).toBe("ENCODING_INVALID_SEQUENCE");
    expect(error.message).toBe("Invalid byte sequence.");
    expect(error.byteRange).toEqual({ start: 3, end: 5 });
    expect(error.details).toEqual({ backend: "native" });
    expect(error.warnings).toEqual([warning]);
    expect(Object.isFrozen(error)).toBe(true);
    expect(Object.isFrozen(error.warnings)).toBe(true);
    expect(Object.isFrozen(error.byteRange)).toBe(true);
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  it("creates immutable structured result branches", () => {
    const success = encodingSuccess("decoded");
    const error = createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Unsupported encoding.",
    });
    const failure = encodingFailure(error);

    expect(success).toEqual({ ok: true, value: "decoded" });
    expect(failure).toEqual({ ok: false, error });
    expect(Object.isFrozen(success)).toBe(true);
    expect(Object.isFrozen(failure)).toBe(true);
  });

  it("freezes and merges warnings in stable order", () => {
    const first = createEncodingWarning({
      code: "ENCODING_BOM_CONFLICT",
      message: "Explicit encoding conflicts with BOM.",
    });
    const second = createEncodingWarning({
      code: "ENCODING_METADATA_CONFLICT",
      message: "Metadata encoding conflicts with BOM.",
    });

    const frozen = freezeEncodingWarnings([first]);
    const merged = mergeEncodingWarnings(frozen, undefined, [second]);

    expect(merged.map((warning) => warning.code)).toEqual([
      "ENCODING_BOM_CONFLICT",
      "ENCODING_METADATA_CONFLICT",
    ]);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(merged)).toBe(true);
  });

  it("exports the baseline diagnostic code list", () => {
    expect(ENCODING_DIAGNOSTIC_CODES).toContain("ENCODING_SOURCE_MAP_UNAVAILABLE");
    expect(ENCODING_DIAGNOSTIC_CODES).toContain("ENCODING_UNMAPPABLE_CHARACTER");
    expect(ENCODING_DIAGNOSTIC_CODES).toContain("ENCODING_UNMAPPABLE_CHARACTER_REPLACED");
    expect(Object.isFrozen(ENCODING_DIAGNOSTIC_CODES)).toBe(true);
  });
});
