import { describe, expect, it } from "vitest";

import {
  DEFAULT_AMBIGUITY_THRESHOLD,
  ENCODING_CANDIDATE_SOURCE_PRIORITY,
  EncodingError,
  createEncodingCandidate,
  createFallbackEncodingCandidate,
  resolveEncodingCandidateDecision,
  sortEncodingCandidates,
} from "../src/index.js";

describe("confidence, candidate and warning policy", () => {
  it("creates immutable validated encoding candidates", () => {
    const candidate = createEncodingCandidate({
      encoding: "utf-8",
      confidence: 1,
      source: "utf8-validation",
      reason: "Valid UTF-8 byte sequence.",
    });

    expect(candidate).toEqual({
      encoding: "utf-8",
      confidence: 1,
      source: "utf8-validation",
      reason: "Valid UTF-8 byte sequence.",
      bomLength: 0,
    });
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(() =>
      createEncodingCandidate({
        encoding: "utf-8",
        confidence: 1.2,
        source: "utf8-validation",
        reason: "Invalid confidence.",
      }),
    ).toThrow(EncodingError);
  });

  it("sorts candidates deterministically by source priority, confidence and canonical encoding order", () => {
    const candidates = [
      createFallbackEncodingCandidate({ encoding: "utf-8", confidence: 1 }),
      createEncodingCandidate({
        encoding: "cp866",
        confidence: 0.8,
        source: "heuristic",
        reason: "Legacy heuristic.",
      }),
      createEncodingCandidate({
        encoding: "windows-1251",
        confidence: 0.8,
        source: "heuristic",
        reason: "Legacy heuristic.",
      }),
      createEncodingCandidate({
        encoding: "utf-8",
        confidence: 0.7,
        source: "utf8-validation",
        reason: "UTF-8 validation.",
      }),
      createEncodingCandidate({
        encoding: "windows-1252",
        confidence: 0.2,
        source: "explicit",
        reason: "Explicit label.",
      }),
      createEncodingCandidate({
        encoding: "utf-16le",
        confidence: 1,
        source: "bom",
        reason: "UTF-16LE BOM.",
        bomLength: 2,
      }),
      createEncodingCandidate({
        encoding: "windows-1251",
        confidence: 0.95,
        source: "metadata",
        reason: "Metadata charset.",
      }),
    ];

    expect(ENCODING_CANDIDATE_SOURCE_PRIORITY).toEqual([
      "explicit",
      "bom",
      "metadata",
      "utf8-validation",
      "utf16-heuristic",
      "heuristic",
      "fallback",
    ]);
    expect(sortEncodingCandidates(candidates).map((candidate) => candidate.encoding)).toEqual([
      "windows-1252",
      "utf-16le",
      "windows-1251",
      "utf-8",
      "windows-1251",
      "cp866",
      "utf-8",
    ]);
  });

  it("deduplicates exact candidates without retaining caller-owned candidate objects", () => {
    const candidate = {
      encoding: "windows-1251",
      confidence: 0.7,
      source: "heuristic",
      reason: "Legacy score.",
      bomLength: 0,
    } as const;

    const sorted = sortEncodingCandidates([candidate, candidate]);

    expect(sorted).toEqual([candidate]);
    expect(sorted[0]).not.toBe(candidate);
    expect(Object.isFrozen(sorted)).toBe(true);
    expect(Object.isFrozen(sorted[0])).toBe(true);
  });

  it("uses fallback only when no stronger candidate is present and reports fallback plus low confidence", () => {
    const decision = resolveEncodingCandidateDecision({
      candidates: [],
      fallbackCandidate: createFallbackEncodingCandidate({
        encoding: "utf-8",
        confidence: 0.25,
      }),
      minConfidence: 0.75,
    });

    expect(decision.selectedCandidate).toMatchObject({
      encoding: "utf-8",
      source: "fallback",
      confidence: 0.25,
    });
    expect(decision.warnings.map((warning) => warning.code)).toEqual([
      "ENCODING_FALLBACK_USED",
      "ENCODING_LOW_CONFIDENCE",
    ]);
    expect(decision.warnings[0]?.details).toMatchObject({
      encoding: "utf-8",
      confidence: 0.25,
      source: "fallback",
      minConfidence: 0.75,
    });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.candidates)).toBe(true);
    expect(Object.isFrozen(decision.warnings)).toBe(true);
  });

  it("does not silently replace a low-confidence heuristic candidate with fallback", () => {
    const decision = resolveEncodingCandidateDecision({
      candidates: [
        createEncodingCandidate({
          encoding: "windows-1251",
          confidence: 0.4,
          source: "heuristic",
          reason: "Weak legacy score.",
        }),
      ],
      fallbackCandidate: createFallbackEncodingCandidate({
        encoding: "utf-8",
        confidence: 0.8,
      }),
      minConfidence: 0.75,
    });

    expect(decision.selectedCandidate).toMatchObject({
      encoding: "windows-1251",
      source: "heuristic",
      confidence: 0.4,
    });
    expect(decision.warnings.map((warning) => warning.code)).toEqual(["ENCODING_LOW_CONFIDENCE"]);
  });

  it("reports ambiguous heuristic candidates with close confidence scores", () => {
    const decision = resolveEncodingCandidateDecision({
      candidates: [
        createEncodingCandidate({
          encoding: "windows-1251",
          confidence: 0.71,
          source: "heuristic",
          reason: "Cyrillic heuristic score.",
        }),
        createEncodingCandidate({
          encoding: "koi8-r",
          confidence: 0.69,
          source: "heuristic",
          reason: "Cyrillic heuristic score.",
        }),
        createEncodingCandidate({
          encoding: "cp866",
          confidence: 0.61,
          source: "heuristic",
          reason: "Cyrillic heuristic score.",
        }),
      ],
      minConfidence: 0.6,
    });

    expect(DEFAULT_AMBIGUITY_THRESHOLD).toBe(0.05);
    expect(decision.selectedCandidate.encoding).toBe("windows-1251");
    expect(decision.warnings).toHaveLength(1);
    expect(decision.warnings[0]).toMatchObject({
      code: "ENCODING_AMBIGUOUS_CANDIDATES",
      message: "Multiple encoding candidates have close confidence scores.",
      details: {
        ambiguityThreshold: 0.05,
        selected: {
          encoding: "windows-1251",
          confidence: 0.71,
          source: "heuristic",
        },
      },
    });
    expect(decision.warnings[0]?.details?.candidates).toEqual([
      {
        encoding: "koi8-r",
        confidence: 0.69,
        source: "heuristic",
        bomLength: 0,
      },
    ]);
  });
});
