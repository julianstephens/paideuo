import { apiRequest } from "../../lib/api/request";

export type ImportKind =
  | "program"
  | "workout-component-results"
  | "daily-check-ins"
  | "heart-rate-recording";

export type ProgramDraftProvenance = {
  field: string;
  state: "extracted" | "inferred";
  evidence?: string;
};

export type ProgramDraftIssue = {
  level: "warning" | "error";
  field: string;
  message: string;
};

export type ProgramDraftConversion = ReturnType<typeof convertMarkdownToProgramDraft>;

const markdownText = (value: string) => value.replace(/[*_`]/g, "").trim();

const markdownSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "item";

const tableRows = (lines: string[], start: number) => {
  if (!lines[start]?.includes("|") || !lines[start + 1]?.includes("|")) return null;
  const parseRow = (line: string) => line.split("|").slice(1, -1).map(markdownText);
  const headers = parseRow(lines[start]);
  const separator = parseRow(lines[start + 1]);
  if (!headers.length || !separator.length || !separator.every((value) => /^:?-+:?$/.test(value)))
    return null;
  const rows: Record<string, string>[] = [];
  for (let index = start + 2; index < lines.length && lines[index].includes("|"); index += 1) {
    const values = parseRow(lines[index]);
    if (values.length) {
      rows.push(
        Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""])),
      );
    }
  }
  return { headers, rows };
};

/** Deterministically converts a structured Markdown menu into an explicit program draft. */
export const convertMarkdownToProgramDraft = (markdown: string) => {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const provenance: ProgramDraftProvenance[] = [];
  const issues: ProgramDraftIssue[] = [];
  const h1 = lines.find((line) => /^#\s+/.test(line));
  const programName = h1 ? markdownText(h1.replace(/^#\s+/, "")) : "";
  if (programName) {
    provenance.push({ field: "program.name", state: "extracted", evidence: h1 });
  } else {
    issues.push({
      level: "error",
      field: "program.name",
      message: "No H1 program title was supplied.",
    });
  }

  const programEvidence = h1 ?? "";
  const programKey = markdownSlug(programName || "program-draft");
  provenance.push({
    field: "program.externalId",
    state: "inferred",
    evidence: programEvidence,
  });

  const headingIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^#{2,4}\s+/.test(line));
  const blockHeadings = headingIndexes.filter(({ line }) => /^##\s+/.test(line));
  const inferredBlocks =
    blockHeadings.length > 0 ? blockHeadings : [{ line: "## Block 1", index: -1 }];
  if (!blockHeadings.length) {
    issues.push({
      level: "warning",
      field: "blocks",
      message: "No H2 block headings were supplied; one block is inferred for review.",
    });
  }

  const blocks = inferredBlocks.map((heading, blockIndex) => {
    const start = heading.index + 1;
    const end =
      inferredBlocks[blockIndex + 1]?.index ??
      headingIndexes.find(({ index }) => index > heading.index && /^##\s+/.test(lines[index]))
        ?.index ??
      lines.length;
    const body = lines.slice(Math.max(0, start), end < 0 ? lines.length : end);
    const blockName =
      heading.index >= 0 ? markdownText(heading.line.replace(/^##\s+/, "")) : "Block 1";
    const blockId = `${programKey}-block-${blockIndex + 1}`;
    provenance.push({
      field: `blocks[${blockIndex}].name`,
      state: heading.index >= 0 ? "extracted" : "inferred",
      evidence: heading.line,
    });
    provenance.push({
      field: `blocks[${blockIndex}].externalId`,
      state: "inferred",
      evidence: heading.line,
    });

    const weekLines = body
      .map((line, offset) => ({ line, index: offset }))
      .filter(({ line }) => /^###\s+/.test(line));
    const explicitDuration = body.join("\n").match(/(?:duration|weeks?)\s*[:=]\s*(\d+)/i);
    let duration = weekLines.length || (explicitDuration ? Number(explicitDuration[1]) : 0);
    if (!duration) {
      const tableStart = body.findIndex((line) => line.includes("|"));
      const table = tableStart >= 0 ? tableRows(body, tableStart) : null;
      if (table?.rows.length) {
        duration = table.rows.length;
        issues.push({
          level: "warning",
          field: `blocks[${blockIndex}].durationWeeks`,
          message: "Duration was inferred from the structured table row count.",
        });
      }
    }
    if (!duration) {
      duration = 1;
      issues.push({
        level: "warning",
        field: `blocks[${blockIndex}].durationWeeks`,
        message: "Duration was not supplied; 1 week is inferred.",
      });
    }

    // Match the schema-v1 block limit before allocating week entries.
    const weekCount = duration <= 520 ? duration : 0;
    if (!weekCount) {
      issues.push({
        level: "error",
        field: `blocks[${blockIndex}].durationWeeks`,
        message: "Block duration exceeds the 520-week import limit. Supply a shorter duration.",
      });
    }

    const slots: { externalId: string; weekday: number; position: number; label: string }[] = [];
    const seenSlotNames = new Set<string>();
    const weekdayPattern =
      /\b(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i;
    const weekdayMap: Record<string, number> = {
      mon: 1,
      monday: 1,
      tue: 2,
      tuesday: 2,
      wed: 3,
      wednesday: 3,
      thu: 4,
      thursday: 4,
      fri: 5,
      friday: 5,
      sat: 6,
      saturday: 6,
      sun: 7,
      sunday: 7,
    };
    const sessionLines = body.filter((line) => /^#{4}\s+|^[*-]\s+/.test(line));
    for (const line of sessionLines) {
      const label = markdownText(line.replace(/^#{4}\s+|^[*-]\s+/, ""));
      if (!label || seenSlotNames.has(label.toLowerCase())) continue;
      seenSlotNames.add(label.toLowerCase());
      const match = line.match(weekdayPattern);
      const weekday = match ? (weekdayMap[match[1].toLowerCase()] ?? 1) : 1;
      slots.push({
        externalId: `${blockId}-slot-${slots.length + 1}`,
        weekday,
        position: slots.length + 1,
        label,
      });
      provenance.push({
        field: `blocks[${blockIndex}].slots[${slots.length - 1}].label`,
        state: "extracted",
        evidence: line,
      });
      provenance.push({
        field: `blocks[${blockIndex}].slots[${slots.length - 1}].weekday`,
        state: match ? "extracted" : "inferred",
        evidence: match?.[0],
      });
    }
    if (!slots.length) {
      issues.push({
        level: "warning",
        field: `blocks[${blockIndex}].slots`,
        message: "No session slots were found; add H4 headings or bulleted sessions.",
      });
    }

    const weeks = Array.from({ length: weekCount }, (_, weekIndex) => {
      const weekHeading = weekLines[weekIndex];
      const weekName = weekHeading ? markdownText(weekHeading.line.replace(/^###\s+/, "")) : "";
      if (weekName) {
        provenance.push({
          field: `blocks[${blockIndex}].weeks[${weekIndex}].label`,
          state: "extracted",
          evidence: weekHeading.line,
        });
      } else {
        provenance.push({
          field: `blocks[${blockIndex}].weeks[${weekIndex}].label`,
          state: "inferred",
          evidence: `position ${weekIndex + 1}`,
        });
      }
      return {
        externalId: `${blockId}-week-${weekIndex + 1}`,
        position: weekIndex + 1,
        label: weekName,
        focus: "",
        weekType: "normal",
        prescriptions: [],
      };
    });

    return {
      externalId: blockId,
      name: blockName,
      objective: "",
      position: blockIndex + 1,
      durationWeeks: duration,
      slots,
      weeks,
    };
  });

  const document = {
    schema: "paideuo",
    version: 1,
    kind: "program",
    data: {
      program: {
        externalId: `${programKey}-program`,
        name: programName,
        objective: "",
        description: "",
        status: "draft",
      },
      blocks,
    },
  } satisfies ImportDocumentV1;

  return { document, provenance, issues };
};

export type ImportDocumentV1<T = Record<string, unknown>> = {
  schema: "paideuo";
  version: 1;
  kind: ImportKind;
  data: T;
};

export type ImportItem = {
  type: string;
  key: string;
  id: string | null;
  status: "create" | "update" | "skip" | "conflict";
  error?: string;
};

export type ImportPreview = {
  previewToken: string;
  schema: "paideuo";
  version: 1;
  kind: ImportKind;
  items: ImportItem[];
  conflicting: number;
};

export type ImportCommit = {
  committed: true;
  rows:
    | { programId: string; scheduleSynchronization: "review-required" | null }
    | { key: string; status: string }[];
};

const endpoint = "/api/paideuo/v1/imports";

export const importsApi = {
  preview: (document: ImportDocumentV1) =>
    apiRequest<ImportPreview>(`${endpoint}/preview`, "POST", document),
  commit: (previewToken: string, document: ImportDocumentV1) =>
    apiRequest<ImportCommit>(`${endpoint}/commit`, "POST", { previewToken, document }),
};
