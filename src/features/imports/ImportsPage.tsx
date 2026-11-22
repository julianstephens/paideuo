import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Grid,
  Heading,
  Input,
  Link,
  NativeSelect,
  Stack,
  Table,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useSearchParams } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Disclosure, FormField, Notice, PageHeader, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import {
  convertMarkdownToProgramDraft,
  type ImportDocumentV1,
  type ImportItem,
  type ProgramDraftConversion,
  importsApi,
} from "./imports";
import { useSession } from "../auth/session";
import { templateKey } from "../templates/templates";
import { MarkdownDraftReview } from "./MarkdownDraftReview";

type CsvKind = "daily-check-ins" | "workout-component-results";
type SourceKind = "json" | "csv" | "markdown";
type IssueLevel = "error" | "warning";

const markdownFile = /\.(?:md|markdown)$/i;

type RowIssue = {
  row: number;
  level: IssueLevel;
  message: string;
};

type CsvColumn = {
  key: string;
  label: string;
  required?: boolean;
  numeric?: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
  choices?: readonly string[];
};

type MappedImport = {
  documents: ImportDocumentV1[];
  rowIssues: RowIssue[];
};

type PreviewState = {
  mapped: MappedImport;
  prepared: { document: ImportDocumentV1; previewToken: string; items: ImportItem[] }[];
  previewItems: (ImportItem & { source: string })[];
  previewErrors: { source: string; message: string }[];
};

type CommitRow = { source: string; key: string; status: string; error?: string };

type CommitState = {
  rows: CommitRow[];
  scheduleReviewRequired: boolean;
};

const statusPalette: Record<string, "gray" | "teal" | "green" | "red"> = {
  create: "teal",
  update: "green",
  skip: "gray",
  conflict: "red",
  created: "teal",
  updated: "green",
  skipped: "gray",
  failed: "red",
  committed: "teal",
};

const dailyColumns: CsvColumn[] = [
  { key: "date", label: "Date", required: true },
  { key: "sleepHours", label: "Sleep hours", numeric: true, min: 0, max: 24 },
  { key: "sleepQuality", label: "Sleep quality", integer: true, min: 1, max: 5 },
  { key: "fatigue", label: "Fatigue", integer: true, min: 1, max: 5 },
  { key: "soreness", label: "Soreness", integer: true, min: 1, max: 5 },
  { key: "readiness", label: "Readiness", integer: true, min: 1, max: 5 },
  { key: "restingHeartRate", label: "Resting heart rate", integer: true, min: 1 },
  { key: "recoveryNotes", label: "Recovery notes" },
  {
    key: "nutritionAdequacy",
    label: "Nutrition adequacy",
    choices: ["adequate", "likely_insufficient", "unsure"],
  },
  {
    key: "trainingFueling",
    label: "Training fueling",
    choices: ["adequate", "inadequate", "not_applicable", "unsure"],
  },
  { key: "proteinGrams", label: "Protein grams", numeric: true, min: 0 },
  { key: "nutritionNotes", label: "Nutrition notes" },
];

const workoutColumns: CsvColumn[] = [
  { key: "sourceSessionId", label: "Source session ID" },
  { key: "sourceWorkoutKey", label: "Source workout key", required: true },
  { key: "completedDate", label: "Completed date", required: true },
  { key: "actualDurationMin", label: "Training duration (min)", integer: true, min: 0 },
  { key: "sessionRpe", label: "Session RPE", numeric: true, min: 1, max: 10 },
  { key: "notes", label: "Workout notes" },
  { key: "componentKey", label: "Component key", required: true },
  { key: "plannedPosition", label: "Planned position", required: true, integer: true, min: 1 },
  { key: "name", label: "Component name", required: true },
  { key: "completed", label: "Component completed", required: true },
  { key: "componentDurationMin", label: "Component duration min", integer: true, min: 0 },
  { key: "setsCompleted", label: "Sets completed", integer: true, min: 0 },
  { key: "repsCompleted", label: "Reps completed" },
  { key: "actualLoadValue", label: "Actual load value", numeric: true, min: 0 },
  { key: "actualLoadUnit", label: "Actual load unit" },
  { key: "componentRpe", label: "Component RPE", numeric: true, min: 1, max: 10 },
  { key: "rounds", label: "Rounds", integer: true, min: 0 },
  { key: "componentNotes", label: "Component notes" },
];

const columnSets: Record<CsvKind, CsvColumn[]> = {
  "daily-check-ins": dailyColumns,
  "workout-component-results": workoutColumns,
};

const canonical = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const parseCsv = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char !== "\r") cell += char;
  }

  if (cell !== "" || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }

  if (!rows.length) return { headers: [] as string[], rows: [] as string[][] };
  const [headers, ...dataRows] = rows;
  return {
    headers: headers.map((header) => header.trim()),
    rows: dataRows.filter((values) => values.some((value) => value !== "")),
  };
};

const inferMapping = (headers: string[], kind: CsvKind) => {
  const byCanonical = new Map(headers.map((header) => [canonical(header), header]));
  return Object.fromEntries(
    columnSets[kind].map((column) => [column.key, byCanonical.get(canonical(column.key)) ?? ""]),
  ) as Record<string, string>;
};

const parseNumber = (
  value: string,
  column: CsvColumn,
  rowNumber: number,
  issues: RowIssue[],
  allowBlank = true,
) => {
  if (value === "") {
    if (allowBlank) return null;
    issues.push({ row: rowNumber, level: "error", message: `${column.label} is required.` });
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    issues.push({ row: rowNumber, level: "error", message: `${column.label} must be a number.` });
    return null;
  }
  if (column.integer && !Number.isInteger(parsed)) {
    issues.push({
      row: rowNumber,
      level: "error",
      message: `${column.label} must be a whole number.`,
    });
    return null;
  }
  if (column.min !== undefined && parsed < column.min) {
    issues.push({
      row: rowNumber,
      level: "error",
      message: `${column.label} must be at least ${column.min}.`,
    });
  }
  if (column.max !== undefined && parsed > column.max) {
    issues.push({
      row: rowNumber,
      level: "error",
      message: `${column.label} must be at most ${column.max}.`,
    });
  }
  return parsed;
};

const toObjectRows = (headers: string[], rows: string[][]) =>
  rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );

const getMapped = (
  row: Record<string, string>,
  mapping: Record<string, string>,
  key: string,
  rowNumber: number,
  issues: RowIssue[],
  required = false,
) => {
  const header = mapping[key];
  const value = (header ? row[header] : "")?.trim() ?? "";
  if (required && value === "") {
    const label =
      columnSets["daily-check-ins"].find((column) => column.key === key)?.label ??
      columnSets["workout-component-results"].find((column) => column.key === key)?.label ??
      key;
    issues.push({ row: rowNumber, level: "error", message: `${label} is required.` });
  }
  return value;
};

const parseBoolean = (value: string, rowNumber: number, label: string, issues: RowIssue[]) => {
  const normalized = value.toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  issues.push({ row: rowNumber, level: "error", message: `${label} must be true or false.` });
  return false;
};

const mapDailyCsv = (
  headers: string[],
  rows: string[][],
  mapping: Record<string, string>,
): MappedImport => {
  const issues: RowIssue[] = [];
  const rowObjects = toObjectRows(headers, rows);
  const seenDates = new Map<string, number>();
  const entries = rowObjects.map((row, index) => {
    const rowNumber = index + 2;
    const date = getMapped(row, mapping, "date", rowNumber, issues, true);

    if (date) {
      const prior = seenDates.get(date);
      if (prior !== undefined) {
        issues.push({
          row: rowNumber,
          level: "error",
          message: `Duplicate date ${date} (already present on row ${prior}).`,
        });
      } else {
        seenDates.set(date, rowNumber);
      }
    }

    const getColumn = (key: string) =>
      columnSets["daily-check-ins"].find((column) => column.key === key)!;
    const getOptionalNumber = (key: string) => {
      const value = getMapped(row, mapping, key, rowNumber, issues);
      if (value === "") {
        if (mapping[key]) {
          issues.push({
            row: rowNumber,
            level: "warning",
            message: `${getColumn(key).label} is blank and will clear that field.`,
          });
        }
        return null;
      }
      return parseNumber(value, getColumn(key), rowNumber, issues);
    };

    const getChoice = (key: string) => {
      const value = getMapped(row, mapping, key, rowNumber, issues);
      if (value === "") {
        if (mapping[key]) {
          issues.push({
            row: rowNumber,
            level: "warning",
            message: `${getColumn(key).label} is blank and will clear that field.`,
          });
        }
        return null;
      }
      const column = getColumn(key);
      if (column.choices && !column.choices.includes(value)) {
        issues.push({
          row: rowNumber,
          level: "error",
          message: `${column.label} must be one of: ${column.choices.join(", ")}.`,
        });
      }
      return value;
    };

    const getText = (key: string, label: string) => {
      const value = getMapped(row, mapping, key, rowNumber, issues);
      if (value === "" && mapping[key]) {
        issues.push({
          row: rowNumber,
          level: "warning",
          message: `${label} is blank and will clear that field.`,
        });
      }
      return value;
    };

    return {
      date,
      recovery: {
        sleepHours: getOptionalNumber("sleepHours"),
        sleepQuality: getOptionalNumber("sleepQuality"),
        fatigue: getOptionalNumber("fatigue"),
        soreness: getOptionalNumber("soreness"),
        readiness: getOptionalNumber("readiness"),
        restingHeartRate: getOptionalNumber("restingHeartRate"),
        notes: getText("recoveryNotes", "Recovery notes"),
      },
      nutrition: {
        nutritionAdequacy: getChoice("nutritionAdequacy"),
        trainingFueling: getChoice("trainingFueling"),
        proteinGrams: getOptionalNumber("proteinGrams"),
        nutritionNotes: getText("nutritionNotes", "Nutrition notes"),
      },
    };
  });

  const documents: ImportDocumentV1[] = [
    {
      schema: "paideuo",
      version: 1,
      kind: "daily-check-ins",
      data: { entries },
    },
  ];

  return { documents, rowIssues: issues };
};

const mapWorkoutCsv = (
  headers: string[],
  rows: string[][],
  mapping: Record<string, string>,
): MappedImport => {
  const issues: RowIssue[] = [];
  const rowObjects = toObjectRows(headers, rows);
  const grouped = new Map<
    string,
    {
      rowNumbers: number[];
      sourceSessionId: string | null;
      sourceWorkoutKey: string;
      completedDate: string;
      actualDurationMin: number | null;
      sessionRpe: number | null;
      notes: string;
      components: {
        key: string;
        plannedPosition: number;
        name: string;
        completed: boolean;
        actualDurationMin: number | null;
        setsCompleted: number | null;
        repsCompleted: string | null;
        actualLoad: { value: number; unit: string } | null;
        rpe: number | null;
        rounds: number | null;
        notes: string;
      }[];
    }
  >();

  rowObjects.forEach((row, index) => {
    const rowNumber = index + 2;
    const sourceWorkoutKey = getMapped(row, mapping, "sourceWorkoutKey", rowNumber, issues, true);
    const completedDate = getMapped(row, mapping, "completedDate", rowNumber, issues, true);
    const sourceSessionId = getMapped(row, mapping, "sourceSessionId", rowNumber, issues) || null;
    const componentKey = getMapped(row, mapping, "componentKey", rowNumber, issues, true);
    const componentName = getMapped(row, mapping, "name", rowNumber, issues, true);
    const completedValue = getMapped(row, mapping, "completed", rowNumber, issues, true);

    const positionRaw = getMapped(row, mapping, "plannedPosition", rowNumber, issues, true);
    const plannedPositionValue = parseNumber(
      positionRaw,
      { key: "plannedPosition", label: "Planned position", integer: true, min: 1 },
      rowNumber,
      issues,
      false,
    );
    const plannedPosition = plannedPositionValue === null ? 1 : plannedPositionValue;

    const completed = parseBoolean(completedValue, rowNumber, "Component completed", issues);

    const key = `${sourceSessionId ?? ""}|${sourceWorkoutKey}|${completedDate}`;

    if (!grouped.has(key)) {
      const durationValue = getMapped(row, mapping, "actualDurationMin", rowNumber, issues);
      const rpeValue = getMapped(row, mapping, "sessionRpe", rowNumber, issues);
      grouped.set(key, {
        rowNumbers: [],
        sourceSessionId,
        sourceWorkoutKey,
        completedDate,
        actualDurationMin:
          durationValue === ""
            ? null
            : parseNumber(
                durationValue,
                { key: "actualDurationMin", label: "Actual duration min", integer: true, min: 0 },
                rowNumber,
                issues,
              ),
        sessionRpe:
          rpeValue === ""
            ? null
            : parseNumber(
                rpeValue,
                { key: "sessionRpe", label: "Session RPE", min: 1, max: 10 },
                rowNumber,
                issues,
              ),
        notes: getMapped(row, mapping, "notes", rowNumber, issues),
        components: [],
      });
    }

    const group = grouped.get(key)!;
    group.rowNumbers.push(rowNumber);

    const existingKey = group.components.find((component) => component.key === componentKey);
    if (existingKey) {
      issues.push({
        row: rowNumber,
        level: "error",
        message: `Duplicate component key ${componentKey} for this workout group.`,
      });
    }
    const existingPosition = group.components.find(
      (component) => component.plannedPosition === plannedPosition,
    );
    if (existingPosition) {
      issues.push({
        row: rowNumber,
        level: "error",
        message: `Duplicate planned position ${plannedPosition} for this workout group.`,
      });
    }

    const componentDuration = getMapped(row, mapping, "componentDurationMin", rowNumber, issues);
    const setsCompleted = getMapped(row, mapping, "setsCompleted", rowNumber, issues);
    const repsCompleted = getMapped(row, mapping, "repsCompleted", rowNumber, issues);
    const loadValue = getMapped(row, mapping, "actualLoadValue", rowNumber, issues);
    const loadUnit = getMapped(row, mapping, "actualLoadUnit", rowNumber, issues);
    const componentRpe = getMapped(row, mapping, "componentRpe", rowNumber, issues);
    const rounds = getMapped(row, mapping, "rounds", rowNumber, issues);

    if ((loadValue === "") !== (loadUnit === "")) {
      issues.push({
        row: rowNumber,
        level: "error",
        message: "Actual load value and unit must both be provided together.",
      });
    }

    group.components.push({
      key: componentKey,
      plannedPosition,
      name: componentName,
      completed,
      actualDurationMin:
        componentDuration === ""
          ? null
          : parseNumber(
              componentDuration,
              {
                key: "componentDurationMin",
                label: "Component duration min",
                integer: true,
                min: 0,
              },
              rowNumber,
              issues,
            ),
      setsCompleted:
        setsCompleted === ""
          ? null
          : parseNumber(
              setsCompleted,
              { key: "setsCompleted", label: "Sets completed", integer: true, min: 0 },
              rowNumber,
              issues,
            ),
      repsCompleted: repsCompleted || null,
      actualLoad:
        loadValue === "" || loadUnit === ""
          ? null
          : {
              value:
                parseNumber(
                  loadValue,
                  { key: "actualLoadValue", label: "Actual load value", min: 0 },
                  rowNumber,
                  issues,
                ) ?? 0,
              unit: loadUnit,
            },
      rpe:
        componentRpe === ""
          ? null
          : parseNumber(
              componentRpe,
              { key: "componentRpe", label: "Component RPE", min: 1, max: 10 },
              rowNumber,
              issues,
            ),
      rounds:
        rounds === ""
          ? null
          : parseNumber(
              rounds,
              { key: "rounds", label: "Rounds", integer: true, min: 0 },
              rowNumber,
              issues,
            ),
      notes: getMapped(row, mapping, "componentNotes", rowNumber, issues),
    });

    ["actualDurationMin", "sessionRpe", "notes"].forEach((field) => {
      const mapped = mapping[field];
      if (!mapped) return;
      const current = row[mapped]?.trim() ?? "";
      const initial =
        field === "actualDurationMin"
          ? group.actualDurationMin == null
            ? ""
            : String(group.actualDurationMin)
          : field === "sessionRpe"
            ? group.sessionRpe == null
              ? ""
              : String(group.sessionRpe)
            : group.notes;
      if (current !== initial) {
        issues.push({
          row: rowNumber,
          level: "warning",
          message: `${field} differs from earlier row in the same workout group; first value is used.`,
        });
      }
    });
  });

  const documents: ImportDocumentV1[] = [...grouped.values()].map((group) => ({
    schema: "paideuo",
    version: 1,
    kind: "workout-component-results",
    data: {
      sourceSessionId: group.sourceSessionId,
      sourceWorkoutKey: group.sourceWorkoutKey,
      completedDate: group.completedDate,
      actualDurationMin: group.actualDurationMin,
      sessionRpe: group.sessionRpe,
      notes: group.notes,
      components: group.components,
    },
  }));

  return { documents, rowIssues: issues };
};

const mapCsv = (
  kind: CsvKind,
  headers: string[],
  rows: string[][],
  mapping: Record<string, string>,
): MappedImport => {
  const required = columnSets[kind].filter((column) => column.required).map((column) => column.key);
  const missingMappedRequired = required.filter((key) => !mapping[key]);
  if (missingMappedRequired.length) {
    return {
      documents: [],
      rowIssues: missingMappedRequired.map((key) => ({
        row: 1,
        level: "error",
        message: `${columnSets[kind].find((column) => column.key === key)?.label ?? key} must be mapped to a CSV column.`,
      })),
    };
  }

  return kind === "daily-check-ins"
    ? mapDailyCsv(headers, rows, mapping)
    : mapWorkoutCsv(headers, rows, mapping);
};

const templateExample = [
  "Session templates",
  "import-v1-session-templates.json",
  new URL("../../../docs/examples/import-v1-session-templates.json", import.meta.url).href,
] as const;

const jsonExamples = [
  templateExample,
  [
    "Training program",
    "import-v1-program.json",
    new URL("../../../docs/examples/import-v1-program.json", import.meta.url).href,
  ],
  [
    "Daily check-ins",
    "import-v1-daily-check-ins.json",
    new URL("../../../docs/examples/import-v1-daily-check-ins.json", import.meta.url).href,
  ],
  [
    "Workout results",
    "import-v1-workout-results.json",
    new URL("../../../docs/examples/import-v1-workout-results.json", import.meta.url).href,
  ],
  [
    "Heart rate recording",
    "import-v1-heart-rate.json",
    new URL("../../../docs/examples/import-v1-heart-rate.json", import.meta.url).href,
  ],
] as const;

const sourceLabel = (document: ImportDocumentV1) => {
  if (document.kind === "daily-check-ins") {
    const entries = document.data?.entries;
    return Array.isArray(entries) ? `Daily check-ins (${entries.length} rows)` : "Daily check-ins";
  }
  if (document.kind === "workout-component-results") {
    const { sourceWorkoutKey, completedDate } = document.data ?? {};
    if (typeof sourceWorkoutKey === "string" && typeof completedDate === "string") {
      return `${sourceWorkoutKey} · ${completedDate}`;
    }
    return "Workout results";
  }
  return formatStatus(document.kind);
};

const formatStatus = (status: string) => status.replaceAll("-", " ");

const previewLabels: Record<ImportItem["status"], string> = {
  create: "New",
  update: "Updates",
  skip: "Unchanged",
  conflict: "Conflicts",
};

export const ImportsPage = () => {
  const [searchParams] = useSearchParams();
  const templateEntry = searchParams.get("kind") === "session-templates";
  const session = useSession();
  const queryClient = useQueryClient();
  const [selectedWorkouts, setSelectedWorkouts] = useState<string[]>([]);
  const [formatOverride, setFormatOverride] = useState<SourceKind | null>(null);
  const [csvKind, setCsvKind] = useState<CsvKind>("daily-check-ins");
  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const [columnOverrides, setColumnOverrides] = useState<Record<string, string>>({});
  const [operation, setOperation] = useState<"read" | "preview" | "commit" | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [markdownDraft, setMarkdownDraft] = useState<ProgramDraftConversion | null>(null);
  const [draftText, setDraftText] = useState("");
  const draftHeading = useRef<HTMLHeadingElement>(null);
  const [confirmCommit, setConfirmCommit] = useState(false);
  const [commit, setCommit] = useState<CommitState | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  const firstCharacter = rawText.trimStart()[0];
  const sourceKind =
    (templateEntry ? "json" : formatOverride) ??
    (firstCharacter === "{" || firstCharacter === "["
      ? "json"
      : firstCharacter === "#" || markdownFile.test(fileName)
        ? "markdown"
        : "csv");
  const busy = operation !== null;
  const csv = useMemo(
    () => (sourceKind === "csv" ? parseCsv(rawText) : null),
    [sourceKind, rawText],
  );
  const mappingColumns = columnSets[csvKind];
  const mapping = csv ? { ...inferMapping(csv.headers, csvKind), ...columnOverrides } : {};
  const missingColumns = mappingColumns.filter((column) => column.required && !mapping[column.key]);
  const rowIssues = preview?.mapped.rowIssues ?? [];
  const blockingIssues = rowIssues.filter((issue) => issue.level === "error");
  const programPreview = preview?.prepared.find(({ document }) => document.kind === "program");
  const reviewedSelection = programPreview?.document.data.templateWorkoutKeys;
  const reviewedKeys = Array.isArray(reviewedSelection) ? reviewedSelection : [];
  const selectionChanged =
    selectedWorkouts.length !== reviewedKeys.length ||
    selectedWorkouts.some((key) => !reviewedKeys.includes(key));
  const hasConflicts = preview?.previewItems.some((item) => item.status === "conflict");
  const canCommit = Boolean(
    preview?.previewItems.length &&
    !preview.previewErrors.length &&
    !blockingIssues.length &&
    !hasConflicts &&
    !selectionChanged,
  );

  useEffect(() => {
    if (markdownDraft) draftHeading.current?.focus();
  }, [markdownDraft]);

  useEffect(() => {
    if (preview) previewHeading.current?.focus();
  }, [preview]);

  useEffect(() => {
    if (commit) resultHeading.current?.focus();
  }, [commit]);

  const resetPreview = () => {
    setPreview(null);
    setSelectedWorkouts([]);
    setCommit(null);
    setConfirmCommit(false);
  };

  const resetResults = () => {
    resetPreview();
    setMarkdownDraft(null);
    setDraftText("");
  };

  const updateText = (text: string) => {
    // Keep manual mappings when only the CSV data rows change.
    const nextHeader = text.split("\n", 1)[0];
    if (nextHeader !== rawText.split("\n", 1)[0]) setColumnOverrides({});
    setRawText(text);
    setParseError(null);
    resetResults();
  };

  const onFile = async (file: File) => {
    setOperation("read");
    try {
      const content = await file.text();
      updateText(content);
      setColumnOverrides({});
      setFileName(file.name);
      setFormatOverride(
        /\.csv$/i.test(file.name)
          ? "csv"
          : /\.json$/i.test(file.name)
            ? "json"
            : markdownFile.test(file.name)
              ? "markdown"
              : null,
      );
    } catch {
      setParseError(`Could not read ${file.name}. Choose the file again or paste its contents.`);
    } finally {
      setOperation(null);
    }
  };

  const toDocuments = (): MappedImport | { error: string } => {
    if (sourceKind === "json" || sourceKind === "markdown") {
      let document: ImportDocumentV1;
      try {
        document = JSON.parse(sourceKind === "markdown" ? draftText : rawText) as ImportDocumentV1;
      } catch {
        return { error: "This data is not valid JSON. Check the syntax and try again." };
      }
      if (
        document?.schema !== "paideuo" ||
        document.version !== 1 ||
        typeof document.kind !== "string" ||
        (sourceKind === "markdown" && document.kind !== "program") ||
        !document.data ||
        typeof document.data !== "object" ||
        Array.isArray(document.data)
      ) {
        return {
          error:
            sourceKind === "markdown"
              ? "Use a Paideuo schema-v1 program document with a data object."
              : "Use a Paideuo JSON import with schema, version, kind, and data fields. See the examples above.",
        };
      }
      if (templateEntry && document.kind !== "session-templates") {
        return { error: "Use a Paideuo JSON document with the session-templates kind." };
      }
      return { documents: [document], rowIssues: [] };
    }
    if (!csv?.headers.length || !csv.rows.length) {
      return { error: "CSV needs a header row and at least one data row." };
    }
    return mapCsv(csvKind, csv.headers, csv.rows, mapping);
  };

  const previewImport = async (workoutKeys?: string[]) => {
    if (busy || !rawText.trim() || (sourceKind === "markdown" && !markdownDraft)) return;
    setOperation("preview");
    setParseError(null);
    resetPreview();
    try {
      const mapped = toDocuments();
      if ("error" in mapped) {
        setParseError(mapped.error);
        return;
      }
      if (mapped.rowIssues.some((issue) => issue.level === "error")) {
        setPreview({ mapped, prepared: [], previewItems: [], previewErrors: [] });
        return;
      }

      const prepared: PreviewState["prepared"] = [];
      const previewItems: PreviewState["previewItems"] = [];
      const previewErrors: PreviewState["previewErrors"] = [];

      for (const source of mapped.documents) {
        const document =
          source.kind === "program" && workoutKeys
            ? { ...source, data: { ...source.data, templateWorkoutKeys: workoutKeys } }
            : source;
        const label = sourceLabel(document);
        try {
          const result = await importsApi.preview(document);
          const selected = document.data.templateWorkoutKeys;
          if (document.kind === "program" && Array.isArray(selected)) setSelectedWorkouts(selected);
          prepared.push({ document, previewToken: result.previewToken, items: result.items });
          previewItems.push(...result.items.map((item) => ({ ...item, source: label })));
        } catch (error) {
          previewErrors.push({
            source: label,
            message: errorMessage(error, "Unable to preview import."),
          });
        }
      }

      setPreview({ mapped, prepared, previewItems, previewErrors });
    } finally {
      setOperation(null);
    }
  };

  const commitImport = async () => {
    if (!preview || !canCommit || !confirmCommit || busy || commit) return;
    setOperation("commit");
    try {
      const rows: CommitRow[] = [];
      let scheduleReviewRequired = false;
      for (const prepared of preview.prepared) {
        const source = sourceLabel(prepared.document);
        try {
          const result = await importsApi.commit(prepared.previewToken, prepared.document);
          const libraryRows = Array.isArray(result.rows)
            ? prepared.document.kind === "session-templates"
              ? result.rows
              : []
            : (result.rows.templates ?? []);
          if (
            libraryRows.some(({ status }) => status === "created" || status === "updated") &&
            session.status === "signed-in"
          ) {
            void queryClient.invalidateQueries({ queryKey: templateKey(session.ownerId) });
          }
          if (Array.isArray(result.rows)) {
            rows.push(
              ...result.rows.map((row) => ({
                source,
                key: row.label ?? row.key,
                status: "status" in row ? row.status : "committed",
              })),
            );
          } else {
            scheduleReviewRequired ||= result.rows.scheduleSynchronization === "review-required";
            rows.push({
              source,
              key: result.rows.programId,
              status: result.rows.unchanged ? "skipped" : "committed",
            });
            rows.push(
              ...libraryRows.map(({ key, label, status }) => ({
                source: "Library",
                key: label ?? key,
                status,
              })),
            );
          }
        } catch (error) {
          rows.push({
            source,
            key: source,
            status: "failed",
            error: errorMessage(error, "Commit failed"),
          });
        }
      }
      setConfirmCommit(false);
      setCommit({ rows, scheduleReviewRequired });
    } finally {
      setOperation(null);
    }
  };

  const renderMapping = (column: CsvColumn) => (
    <FormField key={column.key}>
      {column.label}
      {column.required ? " (required)" : ""}
      <NativeSelect.Root disabled={busy} invalid={column.required && !mapping[column.key]}>
        <NativeSelect.Field
          value={mapping[column.key] ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            setColumnOverrides((current) => ({ ...current, [column.key]: value }));
            setParseError(null);
            resetResults();
          }}
        >
          <option value="">{column.required ? "Choose a column" : "Not mapped"}</option>
          {[...new Set(csv?.headers.filter(Boolean))].map((header) => (
            <option key={header} value={header}>
              {header}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </FormField>
  );

  const columnLayout = { base: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" };
  return (
    <Stack gap="6">
      <PageHeader title={templateEntry ? "Import session templates" : "Bulk imports"} />
      {templateEntry && (
        <Flex gap="4" wrap="wrap">
          <Link asChild variant="underline">
            <RouterLink to="/library">Back to Library</RouterLink>
          </Link>
          <Link href={templateExample[2]} download={templateExample[1]} variant="underline">
            Download template JSON example
          </Link>
        </Flex>
      )}
      <Panel as="section" gap="5">
        <Stack gap="1">
          <Heading as="h2" size="md">
            Add import data
          </Heading>
          <Text color="fg.muted" fontSize="sm">
            {templateEntry
              ? "Upload or paste Paideuo session template JSON."
              : "Upload or paste JSON, CSV, or a Markdown training menu."}
          </Text>
        </Stack>

        <Stack bg="bg.inset" borderWidth="1px" borderRadius="md" p="4" gap="2">
          <Flex gap="3" align="center" wrap="wrap">
            <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
              {fileName ? "Replace file" : "Choose file"}
            </Button>
            <Input
              ref={fileInput}
              type="file"
              hidden
              disabled={busy}
              accept={
                templateEntry
                  ? ".json,application/json"
                  : ".json,.csv,.md,.markdown,text/markdown,application/json,text/csv"
              }
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void onFile(file);
              }}
            />
            <Text fontSize="sm" color="fg.muted" role="status">
              {operation === "read"
                ? "Reading file…"
                : fileName || (templateEntry ? "JSON" : "JSON, CSV, or Markdown")}
            </Text>
            {(fileName || rawText) && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  updateText("");
                  setFileName("");
                  setFormatOverride(null);
                }}
              >
                Clear data
              </Button>
            )}
          </Flex>
          <Disclosure label={fileName ? "View or edit file contents" : "Paste import data"}>
            <FormField>
              File contents
              <Textarea
                rows={6}
                fontFamily="mono"
                spellCheck={false}
                placeholder={
                  templateEntry ? "Paste template JSON here" : "Paste JSON, CSV, or Markdown here"
                }
                value={rawText}
                disabled={busy}
                onChange={(event) => {
                  updateText(event.target.value);
                  setFileName("");
                  if (!event.target.value.trim()) setFormatOverride(null);
                }}
              />
            </FormField>
          </Disclosure>
        </Stack>

        {!templateEntry && (
          <Disclosure label="Supported formats and examples">
            <Stack gap="3" fontSize="sm">
              <Text color="fg.muted">
                Download a Paideuo JSON example for the dataset you want to import.
              </Text>
              <Flex gapX="4" gapY="2" wrap="wrap">
                {jsonExamples.map(([label, filename, href]) => (
                  <Link
                    key={label}
                    color="teal.fg"
                    textDecoration="underline"
                    href={href}
                    download={filename}
                  >
                    {label}
                  </Link>
                ))}
              </Flex>
              <Text color="fg.muted">
                CSV supports daily check-ins and workout results. Put column names on the first row
                and use YYYY-MM-DD dates. For workout results, use one row per workout component.
              </Text>
              <Text color="fg.muted">
                Markdown supports assisted program drafts. Use an H1 title, H2 block headings, H3
                week headings, and H4 or bulleted session names. The draft is never committed until
                previewed and explicitly confirmed.
              </Text>
            </Stack>
          </Disclosure>
        )}

        {!templateEntry && rawText.trim() && (
          <Grid templateColumns={columnLayout} gap="3">
            <FormField>
              File format
              <NativeSelect.Root disabled={busy}>
                <NativeSelect.Field
                  value={sourceKind}
                  onChange={(event) => {
                    setFormatOverride(event.target.value as SourceKind);
                    setParseError(null);
                    resetResults();
                  }}
                >
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                  <option value="markdown">Markdown</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </FormField>
            {csv && (
              <FormField>
                CSV dataset
                <NativeSelect.Root disabled={busy}>
                  <NativeSelect.Field
                    value={csvKind}
                    onChange={(event) => {
                      setCsvKind(event.target.value as CsvKind);
                      setColumnOverrides({});
                      setParseError(null);
                      resetResults();
                    }}
                  >
                    <option value="daily-check-ins">Daily check-ins</option>
                    <option value="workout-component-results">Workout results</option>
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </FormField>
            )}
          </Grid>
        )}

        {csv && csv.rows.length > 0 && (
          <Stack gap="3" borderTopWidth="1px" pt="4">
            <Flex justify="space-between" align="center" gap="2" wrap="wrap">
              <Heading as="h3" size="sm">
                Match CSV columns
              </Heading>
              <Badge>
                {csv.rows.length} {csv.rows.length === 1 ? "row" : "rows"}
              </Badge>
            </Flex>
            <Text fontSize="sm" color="fg.muted">
              {missingColumns.length > 0
                ? "Choose a CSV column for each required field."
                : "All required fields are matched. Review optional fields before previewing."}
            </Text>
            <Grid templateColumns={columnLayout} gap="3">
              {mappingColumns.filter((column) => column.required).map(renderMapping)}
            </Grid>
            <Disclosure
              label={`Optional fields (${mappingColumns.filter((column) => !column.required && mapping[column.key]).length} matched)`}
            >
              <Grid templateColumns={columnLayout} gap="3">
                {mappingColumns.filter((column) => !column.required).map(renderMapping)}
              </Grid>
            </Disclosure>
          </Stack>
        )}

        {parseError && !markdownDraft && <Notice role="alert">{parseError}</Notice>}
        {sourceKind === "markdown" ? (
          <Button
            alignSelf="start"
            colorPalette="teal"
            disabled={busy || !rawText.trim() || !!markdownDraft}
            onClick={() => {
              const draft = convertMarkdownToProgramDraft(rawText);
              setMarkdownDraft(draft);
              setDraftText(JSON.stringify(draft.document, null, 2));
              setParseError(null);
            }}
          >
            Create program draft
          </Button>
        ) : (
          <Button
            alignSelf="start"
            colorPalette="teal"
            onClick={() => void previewImport()}
            loading={operation === "preview"}
            loadingText="Validating…"
            disabled={busy || !rawText.trim() || Boolean(csv?.rows.length && missingColumns.length)}
          >
            Preview changes
          </Button>
        )}
      </Panel>

      {markdownDraft && (
        <MarkdownDraftReview
          draft={markdownDraft}
          headingRef={draftHeading}
          value={draftText}
          error={parseError}
          busy={busy}
          validating={operation === "preview"}
          saved={
            commit?.rows.some(
              (row) =>
                row.source !== "Library" &&
                (row.status === "committed" || row.status === "skipped"),
            ) ?? false
          }
          onEdit={(value) => {
            setDraftText(value);
            setParseError(null);
            resetPreview();
          }}
          onReject={() => {
            setParseError(null);
            resetResults();
          }}
          onPreview={() => void previewImport()}
        />
      )}

      {preview && (
        <Panel as="section" gap="4">
          <Heading as="h2" size="md" ref={previewHeading} tabIndex={-1}>
            Review changes
          </Heading>
          {preview.previewItems.length > 0 && (
            <Flex gap="2" wrap="wrap">
              {Object.entries(previewLabels).map(([status, label]) => (
                <Badge key={status} colorPalette={statusPalette[status]}>
                  {preview.previewItems.filter((item) => item.status === status).length} {label}
                </Badge>
              ))}
            </Flex>
          )}

          {blockingIssues.length > 0 && (
            <Notice role="alert">Fix the CSV errors below, then preview again.</Notice>
          )}
          {rowIssues.length > 0 && (
            <Stack gap="2">
              {blockingIssues.map((issue, index) => (
                <Notice key={index}>
                  Row {issue.row} · {issue.message}
                </Notice>
              ))}
              {rowIssues.length > blockingIssues.length && (
                <Disclosure label={`CSV warnings (${rowIssues.length - blockingIssues.length})`}>
                  <Stack gap="2">
                    {rowIssues
                      .filter((issue) => issue.level === "warning")
                      .map((issue, index) => (
                        <Notice key={index}>
                          Row {issue.row} · {issue.message}
                        </Notice>
                      ))}
                  </Stack>
                </Disclosure>
              )}
            </Stack>
          )}

          {preview.previewErrors.length > 0 && (
            <Stack gap="2">
              {preview.previewErrors.map((entry) => (
                <Notice key={`${entry.source}:${entry.message}`} role="alert">
                  {entry.source}: {entry.message}
                </Notice>
              ))}
            </Stack>
          )}

          {preview.previewItems.length > 0 && (
            <Box overflowX="auto">
              <Table.Root size="sm" variant="outline" aria-label="Import preview">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Source</Table.ColumnHeader>
                    <Table.ColumnHeader>Type</Table.ColumnHeader>
                    <Table.ColumnHeader>Key</Table.ColumnHeader>
                    <Table.ColumnHeader>Status</Table.ColumnHeader>
                    <Table.ColumnHeader>Details</Table.ColumnHeader>
                    {programPreview && <Table.ColumnHeader>Save to Library</Table.ColumnHeader>}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {preview.previewItems.map((item) => (
                    <Table.Row key={`${item.source}:${item.type}:${item.key}`}>
                      <Table.Cell>{item.source}</Table.Cell>
                      <Table.Cell>{item.type}</Table.Cell>
                      <Table.Cell>
                        {item.label && <Text fontWeight="medium">{item.label}</Text>}
                        {item.key}
                      </Table.Cell>
                      <Table.Cell>
                        <Badge colorPalette={statusPalette[item.status] ?? "gray"}>
                          {formatStatus(item.status)}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>{item.error ?? item.detail}</Table.Cell>
                      {programPreview && (
                        <Table.Cell>
                          {item.type === "prescription" && (
                            <Checkbox.Root
                              checked={selectedWorkouts.includes(item.key)}
                              disabled={
                                busy ||
                                !!commit ||
                                (selectedWorkouts.length >= 100 &&
                                  !selectedWorkouts.includes(item.key))
                              }
                              onCheckedChange={({ checked }) => {
                                setConfirmCommit(false);
                                setSelectedWorkouts((current) =>
                                  checked === true
                                    ? [...current, item.key]
                                    : current.filter((key) => key !== item.key),
                                );
                              }}
                            >
                              <Checkbox.HiddenInput
                                aria-label={`Save ${item.label ?? item.key} to Library`}
                              />
                              <Checkbox.Control />
                            </Checkbox.Root>
                          )}
                        </Table.Cell>
                      )}
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Box>
          )}

          {programPreview && selectedWorkouts.length === 100 && (
            <Text fontSize="sm" color="fg.muted">
              You can save up to 100 workouts per import.
            </Text>
          )}
          {programPreview && selectionChanged && (
            <Button
              alignSelf="start"
              disabled={busy}
              onClick={() => void previewImport(selectedWorkouts)}
            >
              Preview Library selection
            </Button>
          )}
          {hasConflicts && (
            <Notice role="alert">Resolve the conflicts above and preview again.</Notice>
          )}
          {!preview.previewItems.length &&
            !preview.previewErrors.length &&
            !blockingIssues.length && (
              <Notice role="status">No records were found to preview.</Notice>
            )}
          {canCommit && !commit && (
            <Stack gap="3" align="start" borderTopWidth="1px" pt="4">
              <Checkbox.Root
                checked={confirmCommit}
                disabled={busy}
                onCheckedChange={({ checked }) => setConfirmCommit(checked === true)}
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control />
                <Checkbox.Label>
                  I reviewed the preview and want to save these changes.
                </Checkbox.Label>
              </Checkbox.Root>
              <Button
                onClick={() => void commitImport()}
                loading={operation === "commit"}
                loadingText="Importing…"
                disabled={!confirmCommit || busy}
                colorPalette="teal"
              >
                Import records
              </Button>
            </Stack>
          )}
        </Panel>
      )}

      {commit && (
        <Panel as="section" gap="4">
          <Heading as="h2" size="md" ref={resultHeading} tabIndex={-1}>
            Import results
          </Heading>
          {commit.rows.some((row) => row.status === "failed") ? (
            <Notice role="alert">
              {commit.rows.filter((row) => row.status === "failed").length} failed. Check the
              details below, then run a fresh preview before retrying.
            </Notice>
          ) : (
            <Notice role="status">Import complete. The results below show what changed.</Notice>
          )}
          {commit.scheduleReviewRequired && (
            <Notice>
              Review the program’s schedule to synchronize it with the imported changes.
            </Notice>
          )}
          {commit.rows.length > 0 && (
            <Box overflowX="auto">
              <Table.Root size="sm" variant="outline" aria-label="Import results">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Source</Table.ColumnHeader>
                    <Table.ColumnHeader>Key</Table.ColumnHeader>
                    <Table.ColumnHeader>Status</Table.ColumnHeader>
                    <Table.ColumnHeader>Details</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {commit.rows.map((row, index) => (
                    <Table.Row key={`${row.source}:${row.key}:${index}`}>
                      <Table.Cell>{row.source}</Table.Cell>
                      <Table.Cell>{row.key}</Table.Cell>
                      <Table.Cell>
                        <Badge colorPalette={statusPalette[row.status] ?? "gray"}>
                          {formatStatus(row.status)}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>{row.error || ""}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Box>
          )}
        </Panel>
      )}
    </Stack>
  );
};
