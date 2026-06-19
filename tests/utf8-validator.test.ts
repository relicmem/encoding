import { describe, expect, it } from "vitest";

import { EncodingError } from "../src/index.js";
import {
  createUtf8Validator,
  tryValidateUtf8,
  validateUtf8,
} from "../src/detector/Utf8Validator.js";

describe("UTF-8 validator", () => {
  it("accepts valid UTF-8 and creates a high-confidence validation candidate", () => {
    const result = validateUtf8(
      new Uint8Array([0x41, 0xd0, 0x96, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80]),
    );

    expect(result).toMatchObject({
      valid: true,
      bytesRead: 10,
      errors: [],
      warnings: [],
      candidate: {
        encoding: "utf-8",
        confidence: 1,
        source: "utf8-validation",
        reason: "Valid UTF-8 byte sequence.",
        bomLength: 0,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.errors)).toBe(true);
    expect(Object.isFrozen(result.warnings)).toBe(true);
  });

  it("does not create a UTF-8 candidate when a stronger explicit or BOM signal is already present", () => {
    expect(
      validateUtf8(new Uint8Array([0x41]), {
        higherPrioritySource: "explicit",
      }).candidate,
    ).toBeUndefined();

    expect(
      validateUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]), {
        higherPrioritySource: "bom",
      }).candidate,
    ).toBeUndefined();
  });

  it("keeps valid UTF-8 as validation-only information when UTF-8 is not allowed", () => {
    const result = validateUtf8(new Uint8Array([0x41]), {
      allowedEncodings: ["windows-1251"],
    });

    expect(result.valid).toBe(true);
    expect(result.candidate).toBeUndefined();
    expect(result.errors).toEqual([]);
  });

  it("reports invalid continuation ranges without consuming the following ASCII byte", () => {
    const result = validateUtf8(new Uint8Array([0x41, 0xc3, 0x28, 0x42]));

    expect(result.valid).toBe(false);
    expect(result.candidate).toBeUndefined();
    expect(result.errors).toEqual([
      {
        byteRange: {
          start: 1,
          end: 2,
        },
        reason: "Invalid UTF-8 continuation byte.",
      },
    ]);
  });

  it.each([
    {
      name: "C0 overlong leading byte",
      bytes: [0xc0, 0xaf],
    },
    {
      name: "E0 overlong three-byte sequence",
      bytes: [0xe0, 0x80, 0x80],
    },
    {
      name: "UTF-16 surrogate scalar",
      bytes: [0xed, 0xa0, 0x80],
    },
    {
      name: "code point above U+10FFFF",
      bytes: [0xf4, 0x90, 0x80, 0x80],
    },
    {
      name: "five-byte leading byte",
      bytes: [0xf8, 0x88, 0x80, 0x80, 0x80],
    },
  ])("rejects forbidden UTF-8 form: $name", ({ bytes }) => {
    const result = validateUtf8(new Uint8Array(bytes));

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({
      byteRange: {
        start: 0,
        end: 1,
      },
    });
  });

  it("supports split multibyte sequences through a streaming-friendly state machine", () => {
    const validator = createUtf8Validator();

    const first = validator.write(new Uint8Array([0xf0]));
    expect(first).toMatchObject({
      bytesRead: 1,
      errors: [],
      pending: {
        byteRange: {
          start: 0,
          end: 1,
        },
        expectedLength: 4,
        consumedLength: 1,
      },
    });
    expect(validator.pending).toEqual(first.pending);

    const second = validator.write(new Uint8Array([0x9f, 0x98]));
    expect(second).toMatchObject({
      bytesRead: 3,
      errors: [],
      pending: {
        byteRange: {
          start: 0,
          end: 3,
        },
        expectedLength: 4,
        consumedLength: 3,
      },
    });

    const third = validator.write(new Uint8Array([0x80, 0x21]));
    expect(third).toMatchObject({
      bytesRead: 5,
      errors: [],
    });
    expect(third.pending).toBeUndefined();

    const result = validator.finish();
    expect(result).toMatchObject({
      valid: true,
      bytesRead: 5,
      errors: [],
      candidate: {
        encoding: "utf-8",
        source: "utf8-validation",
      },
    });
  });

  it("reports invalid split sequences with absolute byte ranges", () => {
    const validator = createUtf8Validator();

    expect(validator.write(new Uint8Array([0xe0])).errors).toEqual([]);

    const writeResult = validator.write(new Uint8Array([0x80, 0x41]));

    expect(writeResult.errors).toEqual([
      {
        byteRange: {
          start: 0,
          end: 1,
        },
        reason: "Invalid UTF-8 continuation byte.",
      },
      {
        byteRange: {
          start: 1,
          end: 2,
        },
        reason: "Invalid UTF-8 leading byte.",
      },
    ]);

    const result = validator.finish();
    expect(result.valid).toBe(false);
    expect(result.bytesRead).toBe(3);
    expect(result.errors).toEqual(writeResult.errors);
  });

  it("reports incomplete trailing sequences at finish", () => {
    const validator = createUtf8Validator();
    validator.write(new Uint8Array([0x41, 0xe2, 0x82]));

    const result = validator.finish();

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      {
        byteRange: {
          start: 1,
          end: 3,
        },
        reason: "Incomplete UTF-8 sequence.",
      },
    ]);
  });

  it("can turn invalid UTF-8 into fatal EncodingError with exact byte range", () => {
    expect(() =>
      validateUtf8(new Uint8Array([0x41, 0xc3, 0x28]), {
        invalidPolicy: "fatal",
      }),
    ).toThrow(EncodingError);

    const result = tryValidateUtf8(new Uint8Array([0xe2, 0x82]), {
      invalidPolicy: "fatal",
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: "ENCODING_INVALID_SEQUENCE",
        message: "Incomplete UTF-8 sequence.",
        byteRange: {
          start: 0,
          end: 2,
        },
        details: {
          encoding: "utf-8",
        },
      });
    }
  });
});
