import { describe, expect, it } from "vitest";

import { createSourceBuffer, createSourceBufferFromChunks } from "../src/source/SourceBuffer.js";

describe("SourceBuffer", () => {
  it("owns a copy of Uint8Array input without dropping BOM or invalid bytes", () => {
    const input = new Uint8Array([0xef, 0xbb, 0xbf, 0xff, 0x41]);
    const source = createSourceBuffer(input);

    input.fill(0);

    expect(source.byteLength).toBe(5);
    expect([...source.bytes]).toEqual([0xef, 0xbb, 0xbf, 0xff, 0x41]);
    expect(Object.isFrozen(source)).toBe(true);
  });

  it("copies only the provided Uint8Array view range", () => {
    const backing = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50]);
    const source = createSourceBuffer(backing.subarray(1, 4));

    backing[2] = 0xff;

    expect([...source.bytes]).toEqual([0x20, 0x30, 0x40]);
  });

  it("owns a copy of ArrayBuffer input", () => {
    const input = new ArrayBuffer(3);
    const view = new Uint8Array(input);
    view.set([0x61, 0x62, 0x63]);

    const source = createSourceBuffer(input);
    view[0] = 0x7a;

    expect([...source.bytes]).toEqual([0x61, 0x62, 0x63]);
  });

  it("exposes defensive byte copies", () => {
    const source = createSourceBuffer(new Uint8Array([0x01, 0x02, 0x03]));
    const firstRead = source.bytes;

    firstRead[0] = 0xff;

    expect([...source.bytes]).toEqual([0x01, 0x02, 0x03]);
  });

  it("returns half-open slice copies", () => {
    const source = createSourceBuffer(new Uint8Array([0x10, 0x20, 0x30, 0x40]));

    const slice = source.slice({ start: 1, end: 3 });
    slice[0] = 0xff;

    expect([...slice]).toEqual([0xff, 0x30]);
    expect([...source.slice({ start: 1, end: 3 })]).toEqual([0x20, 0x30]);
    expect([...source.slice({ start: 2, end: 2 })]).toEqual([]);
    expect([...source.slice()]).toEqual([0x10, 0x20, 0x30, 0x40]);
  });

  it("assembles stream-collected chunks into an owned contiguous buffer", () => {
    const first = new Uint8Array([0xef, 0xbb]);
    const second = new Uint8Array([0xbf, 0xff, 0x41]);
    const source = createSourceBufferFromChunks([first, new Uint8Array(), second]);

    first[0] = 0x00;
    second[1] = 0x00;

    expect(source.byteLength).toBe(5);
    expect([...source.bytes]).toEqual([0xef, 0xbb, 0xbf, 0xff, 0x41]);
  });

  it("rejects invalid byte ranges instead of silently slicing wrong bytes", () => {
    const source = createSourceBuffer(new Uint8Array([0x01, 0x02, 0x03]));

    expect(() => source.slice({ start: -1, end: 1 })).toThrow(RangeError);
    expect(() => source.slice({ start: 0.5, end: 1 })).toThrow(RangeError);
    expect(() => source.slice({ start: 2, end: 1 })).toThrow(RangeError);
    expect(() => source.slice({ start: 0, end: 4 })).toThrow(RangeError);
  });
});
