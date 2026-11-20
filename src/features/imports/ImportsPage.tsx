import {
  Badge,
  Box,
  Button,
  Checkbox,
  Grid,
  Heading,
  Input,
  NativeSelect,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { Notice, PageHeader, Panel } from "../../components/ui";
import { errorMessage } from "../../lib/api/request";
import { type ImportDocumentV1, type ImportItem, importsApi } from "./imports";

type CsvKind = "daily-check-ins" | "workout-component-results";
type SourceKind = "json" | "csv";
type IssueLevel = "error" | "warning";

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

type MappedCsv = {
  kind: CsvKind;
  documents: ImportDocumentV1[];
  rowIssues: RowIssue[];
};

type PreviewState = {
  mapped: MappedCsv;
  prepared: { document: ImportDocumentV1; previewToken: string; items: ImportItem[] }[];
  previewItems: (ImportItem & { source: string })[];
  previewErrors: { source: string; message: string }[];
};

type CommitRow = { source: string; key: string; status: string; error?: string };

type CommitState = {
  rows: CommitRow[];
  errors: { source: string; message: string }[];
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
  { key: "actualDurationMin", label: "Actual duration min", integer: true, min: 0 },
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
): MappedCsv => {
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

  return { kind: "daily-check-ins", documents, rowIssues: issues };
};

const mapWorkoutCsv = (
  headers: string[],
  rows: string[][],
  mapping: Record<string, string>,
): MappedCsv => {
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

  return { kind: "workout-component-results", documents, rowIssues: issues };
};

const mapCsv = (
  kind: CsvKind,
  headers: string[],
  rows: string[][],
  mapping: Record<string, string>,
): MappedCsv => {
  const required = columnSets[kind].filter((column) => column.required).map((column) => column.key);
  const missingMappedRequired = required.filter((key) => !mapping[key]);
  if (missingMappedRequired.length) {
    return {
      kind,
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

const readFileText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.readAsText(file);
  });

const sourceLabel = (document: ImportDocumentV1) => {
  if (document.kind === "daily-check-ins") {
    return `daily-check-ins (${(document.data as { entries: unknown[] }).entries.length} rows)`;
  }
  if (document.kind === "workout-component-results") {
    const data = document.data as { sourceWorkoutKey: string; completedDate: string };
    return `${data.sourceWorkoutKey} · ${data.completedDate}`;
  }
  return document.kind;
};

const defaultMapping = (kind: CsvKind) =>
  Object.fromEntries(columnSets[kind].map((column) => [column.key, ""])) as Record<string, string>;

const formatStatus = (status: string) => status.replaceAll("-", " ");

export const ImportsPage = () => {
  const [sourceKind, setSourceKind] = useState<SourceKind>("json");
  const [csvKind, setCsvKind] = useState<CsvKind>("daily-check-ins");
  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>(defaultMapping("daily-check-ins"));
  const [busy, setBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [confirmCommit, setConfirmCommit] = useState(false);
  const [commit, setCommit] = useState<CommitState | null>(null);

  const mappingColumns = useMemo(() => columnSets[csvKind], [csvKind]);
  const rowIssues = preview?.mapped.rowIssues ?? [];
  const blockingIssues = rowIssues.filter((issue) => issue.level === "error");
  const hasConflicts = (preview?.previewItems ?? []).some((item) => item.status === "conflict");

  const resetResults = () => {
    setPreview(null);
    setPreviewError(null);
    setCommit(null);
    setConfirmCommit(false);
  };

  const onFile = async (file: File | null) => {
    resetResults();
    setParseError(null);
    if (!file) {
      setFileName("");
      setRawText("");
      setCsvHeaders([]);
      setCsvRows([]);
      return;
    }

    setFileName(file.name);
    try {
      const text = await readFileText(file);
      setRawText(text);
      if (sourceKind === "csv") {
        const parsed = parseCsv(text);
        setCsvHeaders(parsed.headers);
        setCsvRows(parsed.rows);
        setMapping(inferMapping(parsed.headers, csvKind));
      }
    } catch {
      setParseError("Unable to read the selected file.");
    }
  };

  const toDocuments = (): MappedCsv | { error: string } => {
    if (sourceKind === "json") {
      let document: ImportDocumentV1;
      try {
        document = JSON.parse(rawText) as ImportDocumentV1;
      } catch {
        return { error: "Malformed JSON. Provide a valid import envelope." };
      }
      return { kind: document.kind as CsvKind, documents: [document], rowIssues: [] };
    }
    if (!csvHeaders.length) return { error: "CSV must include a header row." };
    if (!csvRows.length) return { error: "CSV has no data rows." };
    return mapCsv(csvKind, csvHeaders, csvRows, mapping);
  };

  const previewImport = async () => {
    setBusy(true);
    setParseError(null);
    setPreviewError(null);
    resetResults();
    try {
      const mapped = toDocuments();
      if ("error" in mapped) {
        setParseError(mapped.error);
        return;
      }
      if (!mapped.documents.length) {
        setParseError("No import records were found.");
        return;
      }
      if (mapped.rowIssues.some((issue) => issue.level === "error")) {
        setPreview({ mapped, prepared: [], previewItems: [], previewErrors: [] });
        return;
      }

      const prepared: PreviewState["prepared"] = [];
      const previewItems: PreviewState["previewItems"] = [];
      const previewErrors: PreviewState["previewErrors"] = [];

      for (const document of mapped.documents) {
        const label = sourceLabel(document);
        try {
          const result = await importsApi.preview(document);
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
      if (!previewItems.length && !previewErrors.length) {
        setPreviewError("No preview rows were returned.");
      }
    } finally {
      setBusy(false);
    }
  };

  const commitImport = async () => {
    if (!preview || !confirmCommit || busy) return;
    setBusy(true);
    setCommit(null);
    try {
      const rows: CommitRow[] = [];
      const errors: CommitState["errors"] = [];
      for (const prepared of preview.prepared) {
        const source = sourceLabel(prepared.document);
        try {
          const result = await importsApi.commit(prepared.previewToken, prepared.document);
          if (Array.isArray(result.rows)) {
            rows.push(
              ...result.rows.map((row) => ({
                source,
                key: "key" in row ? row.key : prepared.document.kind,
                status: "status" in row ? row.status : "committed",
              })),
            );
          } else {
            rows.push({
              source,
              key: result.rows.programId,
              status: "committed",
            });
          }
        } catch (error) {
          errors.push({ source, message: errorMessage(error, "Unable to commit import.") });
          rows.push({
            source,
            key: source,
            status: "failed",
            error: errorMessage(error, "Commit failed"),
          });
        }
      }
      setCommit({ rows, errors });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="6">
      <PageHeader title="Bulk imports" />
      <Panel as="section" gap="4">
        <Heading as="h2" size="md">
          1. Upload import file
        </Heading>
        <Grid templateColumns={{ base: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" }} gap="3">
          <label>
            <Text fontSize="sm" fontWeight="medium" mb="1.5">
              File format
            </Text>
            <NativeSelect.Root>
              <NativeSelect.Field
                value={sourceKind}
                onChange={(event) => {
                  const next = event.target.value as SourceKind;
                  setSourceKind(next);
                  setParseError(null);
                  resetResults();
                }}
              >
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </label>
          {sourceKind === "csv" && (
            <label>
              <Text fontSize="sm" fontWeight="medium" mb="1.5">
                CSV dataset
              </Text>
              <NativeSelect.Root>
                <NativeSelect.Field
                  value={csvKind}
                  onChange={(event) => {
                    const next = event.target.value as CsvKind;
                    setCsvKind(next);
                    setMapping(defaultMapping(next));
                    setParseError(null);
                    resetResults();
                    if (csvHeaders.length) setMapping(inferMapping(csvHeaders, next));
                  }}
                >
                  <option value="daily-check-ins">Daily check-ins</option>
                  <option value="workout-component-results">Workout results</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </label>
          )}
        </Grid>

        <Stack gap="2">
          <Input
            type="file"
            accept={sourceKind === "json" ? ".json,application/json" : ".csv,text/csv"}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              void onFile(file);
            }}
          />
          {fileName && (
            <Text fontSize="sm" color="fg.muted">
              Selected file: {fileName}
            </Text>
          )}
        </Stack>

        <Box>
          <Text fontSize="sm" fontWeight="medium" mb="1.5">
            {sourceKind === "json" ? "Import JSON" : "CSV data"}
          </Text>
          <Input
            as="textarea"
            minH="12rem"
            fontFamily="mono"
            value={rawText}
            onChange={(event) => {
              setRawText(event.target.value);
              resetResults();
              setParseError(null);
              if (sourceKind === "csv") {
                const parsed = parseCsv(event.target.value);
                setCsvHeaders(parsed.headers);
                setCsvRows(parsed.rows);
                setMapping(inferMapping(parsed.headers, csvKind));
              }
            }}
          />
        </Box>

        {sourceKind === "csv" && (
          <Stack gap="3">
            <Heading as="h3" size="sm">
              Column mapping
            </Heading>
            {!csvHeaders.length ? (
              <Notice>Upload or paste CSV data with a header row to map columns.</Notice>
            ) : (
              <Grid
                templateColumns={{ base: "minmax(0, 1fr)", lg: "repeat(2, minmax(0, 1fr))" }}
                gap="3"
              >
                {mappingColumns.map((column) => (
                  <label key={column.key}>
                    <Text fontSize="sm" fontWeight="medium" mb="1.5">
                      {column.label}
                      {column.required ? " *" : ""}
                    </Text>
                    <NativeSelect.Root>
                      <NativeSelect.Field
                        value={mapping[column.key] ?? ""}
                        onChange={(event) => {
                          setMapping((current) => ({
                            ...current,
                            [column.key]: event.target.value,
                          }));
                          resetResults();
                        }}
                      >
                        <option value="">Not mapped</option>
                        {csvHeaders.map((header) => (
                          <option key={`${column.key}:${header}`} value={header}>
                            {header}
                          </option>
                        ))}
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  </label>
                ))}
              </Grid>
            )}
          </Stack>
        )}

        {parseError && <Notice role="alert">{parseError}</Notice>}
        <Button alignSelf="start" onClick={() => void previewImport()} loading={busy}>
          2. Validate and preview
        </Button>
      </Panel>

      {preview && (
        <Panel as="section" gap="4">
          <Heading as="h2" size="md">
            3. Review validation and preview
          </Heading>

          {rowIssues.length > 0 && (
            <Stack gap="2">
              {rowIssues.map((issue) => (
                <Notice
                  key={`${issue.level}:${issue.row}:${issue.message}`}
                  role={issue.level === "error" ? "alert" : "status"}
                >
                  Row {issue.row}: {issue.message}
                </Notice>
              ))}
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
              <Table.Root size="sm" variant="outline">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Source</Table.ColumnHeader>
                    <Table.ColumnHeader>Type</Table.ColumnHeader>
                    <Table.ColumnHeader>Key</Table.ColumnHeader>
                    <Table.ColumnHeader>Status</Table.ColumnHeader>
                    <Table.ColumnHeader>Error</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {preview.previewItems.map((item) => (
                    <Table.Row key={`${item.source}:${item.type}:${item.key}`}>
                      <Table.Cell>{item.source}</Table.Cell>
                      <Table.Cell>{item.type}</Table.Cell>
                      <Table.Cell>{item.key}</Table.Cell>
                      <Table.Cell>
                        <Badge colorPalette={statusPalette[item.status] ?? "gray"}>
                          {formatStatus(item.status)}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>{item.error || ""}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Box>
          )}

          {previewError && <Notice role="alert">{previewError}</Notice>}
          {preview.previewItems.length > 0 &&
            !preview.previewErrors.length &&
            !blockingIssues.length && (
              <Stack gap="3" align="start">
                {hasConflicts ? (
                  <Notice role="alert">Resolve conflicts in preview before commit.</Notice>
                ) : (
                  <Notice role="status">Preview is ready. Confirm to commit the import.</Notice>
                )}
                <Checkbox.Root
                  checked={confirmCommit}
                  onCheckedChange={({ checked }) => setConfirmCommit(checked === true)}
                >
                  <Checkbox.HiddenInput />
                  <Checkbox.Control />
                  <Checkbox.Label>I confirm these rows should be committed.</Checkbox.Label>
                </Checkbox.Root>
                <Button
                  onClick={() => void commitImport()}
                  loading={busy}
                  disabled={!confirmCommit || hasConflicts}
                  colorPalette="teal"
                >
                  4. Commit import
                </Button>
              </Stack>
            )}
        </Panel>
      )}

      {commit && (
        <Panel as="section" gap="4">
          <Heading as="h2" size="md">
            5. Commit results
          </Heading>
          {commit.errors.length > 0 && (
            <Stack gap="2">
              {commit.errors.map((entry) => (
                <Notice key={`${entry.source}:${entry.message}`} role="alert">
                  {entry.source}: {entry.message}
                </Notice>
              ))}
            </Stack>
          )}
          {commit.rows.length > 0 && (
            <Box overflowX="auto">
              <Table.Root size="sm" variant="outline">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Source</Table.ColumnHeader>
                    <Table.ColumnHeader>Key</Table.ColumnHeader>
                    <Table.ColumnHeader>Status</Table.ColumnHeader>
                    <Table.ColumnHeader>Error</Table.ColumnHeader>
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
