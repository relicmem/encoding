import type { EncodingCandidate, NormalizedEncodingLabel } from "../contracts/detection.js";
import {
  createEncodingWarning,
  freezeEncodingWarnings,
  isEncodingError,
} from "../contracts/diagnostics.js";
import type { EncodingWarning } from "../contracts/diagnostics.js";
import type { EncodingMetadata, RelicMEMEncodingName } from "../contracts/encoding.js";
import type { EncodingProfile } from "../contracts/profile.js";
import { createEncodingCandidate } from "../detector/ConfidencePolicy.js";
import { normalizeEncodingLabel } from "./EncodingRegistry.js";

export type EncodingMetadataField = "declaredEncoding" | "contentType" | "htmlHeadSample";

export type EncodingMetadataIgnoredReason =
  | "metadata-disabled"
  | "metadata-empty"
  | "no-encoding-label"
  | "unsupported-metadata"
  | "explicit-encoding"
  | "bom";

export interface EncodingMetadataLabel {
  readonly field: EncodingMetadataField;
  readonly inputLabel: string;
  readonly label: NormalizedEncodingLabel;
  readonly confidence: number;
  readonly reason: string;
}

export interface EncodingMetadataBomSignal {
  readonly encoding: RelicMEMEncodingName;
  readonly bomLength: number;
  readonly label?: NormalizedEncodingLabel;
}

export interface SniffEncodingMetadataOptions {
  readonly metadata?: EncodingMetadata;
  readonly profile: EncodingProfile;
  readonly allowedEncodings: readonly RelicMEMEncodingName[];
  readonly explicitEncoding?: NormalizedEncodingLabel;
  readonly bom?: EncodingMetadataBomSignal;
}

export interface EncodingMetadataSniffingResult {
  readonly enabled: boolean;
  readonly labels: readonly EncodingMetadataLabel[];
  readonly warnings: readonly EncodingWarning[];
  readonly sourceName?: string;
  readonly selectedLabel?: EncodingMetadataLabel;
  readonly candidate?: EncodingCandidate;
  readonly ignoredReason?: EncodingMetadataIgnoredReason;
}

export interface ExtractedEncodingMetadataLabel {
  readonly field: EncodingMetadataField;
  readonly inputLabel: string;
  readonly confidence: number;
  readonly reason: string;
}

const METADATA_FIELD_CONFIDENCE = Object.freeze({
  declaredEncoding: 0.95,
  contentType: 0.9,
  htmlHeadSample: 0.85,
} as const satisfies Record<EncodingMetadataField, number>);

const HTML_META_TAG_PATTERN = /<meta\b[^>]*>/giu;
const HTML_ATTRIBUTE_PATTERN =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/giu;
const CONTENT_TYPE_CHARSET_PATTERN = /(?:^|;)\s*charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]+))/iu;

export function sniffEncodingMetadata(
  options: SniffEncodingMetadataOptions,
): EncodingMetadataSniffingResult {
  const sourceName = options.metadata?.sourceName;

  if (!options.profile.metadataSniffing) {
    return createMetadataSniffingResult({
      enabled: false,
      sourceName,
      ignoredReason: "metadata-disabled",
    });
  }

  if (options.metadata === undefined || isEmptyMetadata(options.metadata)) {
    return createMetadataSniffingResult({
      enabled: true,
      sourceName,
      ignoredReason: "metadata-empty",
    });
  }

  const rawLabels = extractRawEncodingMetadataLabels(options.metadata);

  if (rawLabels.length === 0) {
    return createMetadataSniffingResult({
      enabled: true,
      sourceName,
      ignoredReason: "no-encoding-label",
    });
  }

  const warnings: EncodingWarning[] = [];
  const labels = normalizeMetadataLabels(rawLabels, options, warnings);

  if (labels.length === 0) {
    return createMetadataSniffingResult({
      enabled: true,
      sourceName,
      warnings,
      ignoredReason: "unsupported-metadata",
    });
  }

  const selectedLabel = labels[0];

  if (selectedLabel === undefined) {
    throw new Error("Expected at least one normalized metadata label.");
  }

  warnings.push(...createInternalMetadataConflictWarnings(labels, selectedLabel, sourceName));

  if (options.explicitEncoding !== undefined) {
    warnings.push(
      ...createHigherPriorityMetadataConflictWarnings({
        higherPrioritySource: "explicit",
        higherPriorityEncoding: options.explicitEncoding.canonical,
        higherPriorityLabel: options.explicitEncoding.inputLabel,
        selectedLabel,
        sourceName,
      }),
    );

    return createMetadataSniffingResult({
      enabled: true,
      sourceName,
      labels,
      selectedLabel,
      warnings,
      ignoredReason: "explicit-encoding",
    });
  }

  if (options.bom !== undefined) {
    warnings.push(
      ...createHigherPriorityMetadataConflictWarnings({
        higherPrioritySource: "bom",
        higherPriorityEncoding: options.bom.encoding,
        higherPriorityLabel: options.bom.label?.inputLabel,
        bomLength: options.bom.bomLength,
        selectedLabel,
        sourceName,
      }),
    );

    return createMetadataSniffingResult({
      enabled: true,
      sourceName,
      labels,
      selectedLabel,
      warnings,
      ignoredReason: "bom",
    });
  }

  return createMetadataSniffingResult({
    enabled: true,
    sourceName,
    labels,
    selectedLabel,
    warnings,
    candidate: createMetadataCandidate(selectedLabel),
  });
}

export function extractCharsetFromContentType(contentType: string): string | undefined {
  return firstDefinedMatch(CONTENT_TYPE_CHARSET_PATTERN.exec(contentType));
}

export function extractHtmlMetadataLabels(
  htmlHeadSample: string,
): readonly ExtractedEncodingMetadataLabel[] {
  const labels: ExtractedEncodingMetadataLabel[] = [];

  for (const tagMatch of htmlHeadSample.matchAll(HTML_META_TAG_PATTERN)) {
    const tag = tagMatch[0];
    const attributes = parseHtmlAttributes(tag);
    const directCharset = attributes.get("charset");

    if (directCharset !== undefined) {
      labels.push(createRawMetadataLabel("htmlHeadSample", directCharset, "HTML meta charset."));
    }

    const httpEquiv = attributes.get("http-equiv")?.trim().toLowerCase();
    const content = attributes.get("content");

    if (httpEquiv === "content-type" && content !== undefined) {
      const contentCharset = extractCharsetFromContentType(content);

      if (contentCharset !== undefined) {
        labels.push(
          createRawMetadataLabel(
            "htmlHeadSample",
            contentCharset,
            "HTML content-type meta charset.",
          ),
        );
      }
    }
  }

  return Object.freeze(labels);
}

function extractRawEncodingMetadataLabels(
  metadata: EncodingMetadata,
): readonly ExtractedEncodingMetadataLabel[] {
  const labels: ExtractedEncodingMetadataLabel[] = [];

  if (metadata.declaredEncoding !== undefined) {
    labels.push(
      createRawMetadataLabel(
        "declaredEncoding",
        metadata.declaredEncoding,
        "Declared metadata encoding.",
      ),
    );
  }

  if (metadata.contentType !== undefined) {
    const contentTypeCharset = extractCharsetFromContentType(metadata.contentType);

    if (contentTypeCharset !== undefined) {
      labels.push(
        createRawMetadataLabel("contentType", contentTypeCharset, "HTTP content-type charset."),
      );
    }
  }

  if (metadata.htmlHeadSample !== undefined) {
    labels.push(...extractHtmlMetadataLabels(metadata.htmlHeadSample));
  }

  return Object.freeze(labels);
}

function normalizeMetadataLabels(
  rawLabels: readonly ExtractedEncodingMetadataLabel[],
  options: SniffEncodingMetadataOptions,
  warnings: EncodingWarning[],
): EncodingMetadataLabel[] {
  const labels: EncodingMetadataLabel[] = [];

  for (const rawLabel of rawLabels) {
    const label = tryNormalizeMetadataLabel(rawLabel, options, warnings);

    if (label !== undefined) {
      labels.push(label);
    }
  }

  return labels;
}

function tryNormalizeMetadataLabel(
  rawLabel: ExtractedEncodingMetadataLabel,
  options: SniffEncodingMetadataOptions,
  warnings: EncodingWarning[],
): EncodingMetadataLabel | undefined {
  try {
    const label = normalizeEncodingLabel(rawLabel.inputLabel, {
      source: "metadata",
      profile: options.profile,
    });

    if (!options.allowedEncodings.includes(label.canonical)) {
      warnings.push(
        createEncodingWarning({
          code: "ENCODING_UNSUPPORTED_ENCODING",
          message: "Metadata encoding is not allowed by the active options and was ignored.",
          details: metadataWarningDetails(options.metadata?.sourceName, {
            metadataField: rawLabel.field,
            inputLabel: rawLabel.inputLabel,
            encoding: label.canonical,
            allowedEncodings: Object.freeze([...options.allowedEncodings]),
          }),
        }),
      );

      return undefined;
    }

    return freezeMetadataLabel({
      field: rawLabel.field,
      inputLabel: rawLabel.inputLabel,
      label,
      confidence: rawLabel.confidence,
      reason: rawLabel.reason,
    });
  } catch (error) {
    if (!isEncodingError(error)) {
      throw error;
    }

    warnings.push(
      createEncodingWarning({
        code: "ENCODING_UNSUPPORTED_LABEL",
        message: "Invalid metadata encoding label was ignored.",
        details: metadataWarningDetails(options.metadata?.sourceName, {
          metadataField: rawLabel.field,
          inputLabel: rawLabel.inputLabel,
          normalizationDetails: error.details,
        }),
      }),
    );

    return undefined;
  }
}

function createInternalMetadataConflictWarnings(
  labels: readonly EncodingMetadataLabel[],
  selectedLabel: EncodingMetadataLabel,
  sourceName: string | undefined,
): readonly EncodingWarning[] {
  const conflictingLabels = labels.filter(
    (label) => label.label.canonical !== selectedLabel.label.canonical,
  );

  if (conflictingLabels.length === 0) {
    return [];
  }

  return [
    createEncodingWarning({
      code: "ENCODING_METADATA_CONFLICT",
      message:
        "Conflicting metadata encodings were found. Using the highest priority metadata source.",
      details: metadataWarningDetails(sourceName, {
        selected: metadataLabelDetails(selectedLabel),
        conflicts: Object.freeze(conflictingLabels.map((label) => metadataLabelDetails(label))),
      }),
    }),
  ];
}

function createHigherPriorityMetadataConflictWarnings(options: {
  readonly higherPrioritySource: "explicit" | "bom";
  readonly higherPriorityEncoding: RelicMEMEncodingName;
  readonly higherPriorityLabel?: string | undefined;
  readonly bomLength?: number | undefined;
  readonly selectedLabel: EncodingMetadataLabel;
  readonly sourceName?: string | undefined;
}): readonly EncodingWarning[] {
  if (options.higherPriorityEncoding === options.selectedLabel.label.canonical) {
    return [];
  }

  const code =
    options.higherPrioritySource === "bom" ? "ENCODING_BOM_CONFLICT" : "ENCODING_METADATA_CONFLICT";
  const message =
    options.higherPrioritySource === "bom"
      ? "Metadata encoding conflicts with BOM and was ignored."
      : "Metadata encoding conflicts with explicit encoding and was ignored.";

  return [
    createEncodingWarning({
      code,
      message,
      details: metadataWarningDetails(options.sourceName, {
        selected: metadataLabelDetails(options.selectedLabel),
        higherPrioritySource: options.higherPrioritySource,
        higherPriorityEncoding: options.higherPriorityEncoding,
        ...optionalProperty("higherPriorityLabel", options.higherPriorityLabel),
        ...optionalProperty("bomLength", options.bomLength),
      }),
    }),
  ];
}

function createMetadataCandidate(label: EncodingMetadataLabel): EncodingCandidate {
  return createEncodingCandidate({
    encoding: label.label.canonical,
    confidence: label.confidence,
    source: "metadata",
    reason: label.reason,
    bomLength: 0,
  });
}

function createRawMetadataLabel(
  field: EncodingMetadataField,
  inputLabel: string,
  reason: string,
): ExtractedEncodingMetadataLabel {
  return Object.freeze({
    field,
    inputLabel,
    confidence: METADATA_FIELD_CONFIDENCE[field],
    reason,
  });
}

function createMetadataSniffingResult(options: {
  readonly enabled: boolean;
  readonly labels?: readonly EncodingMetadataLabel[];
  readonly warnings?: readonly EncodingWarning[];
  readonly sourceName?: string | undefined;
  readonly selectedLabel?: EncodingMetadataLabel | undefined;
  readonly candidate?: EncodingCandidate | undefined;
  readonly ignoredReason?: EncodingMetadataIgnoredReason | undefined;
}): EncodingMetadataSniffingResult {
  const labels = Object.freeze(
    [...(options.labels ?? [])].map((label) => freezeMetadataLabel(label)),
  );
  const selectedLabel =
    options.selectedLabel === undefined ? undefined : freezeMetadataLabel(options.selectedLabel);

  return Object.freeze({
    enabled: options.enabled,
    labels,
    warnings: freezeEncodingWarnings(options.warnings ?? []),
    ...optionalProperty("sourceName", options.sourceName),
    ...optionalProperty("selectedLabel", selectedLabel),
    ...optionalProperty("candidate", freezeCandidate(options.candidate)),
    ...optionalProperty("ignoredReason", options.ignoredReason),
  });
}

function freezeMetadataLabel(label: EncodingMetadataLabel): EncodingMetadataLabel {
  return Object.freeze({
    field: label.field,
    inputLabel: label.inputLabel,
    label: Object.freeze({
      ...optionalProperty("inputLabel", label.label.inputLabel),
      canonical: label.label.canonical,
      aliases: Object.freeze([...label.label.aliases]),
      source: label.label.source,
    }),
    confidence: label.confidence,
    reason: label.reason,
  });
}

function freezeCandidate(candidate: EncodingCandidate | undefined): EncodingCandidate | undefined {
  if (candidate === undefined) {
    return undefined;
  }

  return Object.freeze({
    encoding: candidate.encoding,
    confidence: candidate.confidence,
    source: candidate.source,
    reason: candidate.reason,
    bomLength: candidate.bomLength,
  });
}

function metadataWarningDetails(
  sourceName: string | undefined,
  details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...details,
    ...optionalProperty("sourceName", sourceName),
  });
}

function metadataLabelDetails(label: EncodingMetadataLabel): Readonly<Record<string, unknown>> {
  return Object.freeze({
    metadataField: label.field,
    inputLabel: label.inputLabel,
    encoding: label.label.canonical,
    confidence: label.confidence,
  });
}

function parseHtmlAttributes(tag: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();

  for (const attributeMatch of tag.matchAll(HTML_ATTRIBUTE_PATTERN)) {
    const rawName = attributeMatch[1];

    if (rawName === undefined) {
      continue;
    }

    const name = rawName.toLowerCase();

    if (name === "meta") {
      continue;
    }

    attributes.set(name, attributeMatch[2] ?? attributeMatch[3] ?? attributeMatch[4] ?? "");
  }

  return attributes;
}

function firstDefinedMatch(match: RegExpExecArray | null): string | undefined {
  if (match === null) {
    return undefined;
  }

  return match[1] ?? match[2] ?? match[3];
}

function isEmptyMetadata(metadata: EncodingMetadata): boolean {
  return (
    metadata.declaredEncoding === undefined &&
    metadata.contentType === undefined &&
    metadata.htmlHeadSample === undefined &&
    metadata.sourceName === undefined
  );
}

function optionalProperty<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}
