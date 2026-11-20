/* oxlint-disable import/no-commonjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const test = require("node:test");
const PocketBase = require("pocketbase/cjs");

const repoRoot = path.join(__dirname, "..", "..");
const migrationsDir = path.join(repoRoot, "backend", "pb_migrations");
const baseHooksDir = path.join(repoRoot, "backend", "pb_hooks");
const sampleProgramPath = path.join(repoRoot, "docs", "examples", "import-v1-program.json");
const injectedFailureHookName = "zz_imports_injected_failure.pb.js";
const injectedFailureMarker = "__INJECT_NESTED_FAIL__";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a test port.")));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });

const waitForHealth = async (baseUrl, timeoutMs, processRef) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (processRef.exitCode !== null) {
      throw new Error(`PocketBase exited early with status ${processRef.exitCode}.`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
      lastError = new Error(`Unexpected health status ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await pause(100);
  }
  throw new Error(`Timed out waiting for PocketBase healthcheck. ${String(lastError ?? "")}`);
};

const pocketbaseCreateOrUpdateSuperuser = (dataDir, hooksDir, email, password) => {
  const result = spawnSync(
    "pocketbase",
    [
      "superuser",
      "upsert",
      email,
      password,
      `--dir=${dataDir}`,
      `--migrationsDir=${migrationsDir}`,
      `--hooksDir=${hooksDir}`,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`Failed to configure superuser: ${result.stderr || result.stdout}`);
  }
};

const makeProgramDocument = () => ({
  schema: "paideuo",
  version: 1,
  kind: "program",
  data: {
    program: {
      externalId: "integration-program",
      name: "Integration Program",
      description: "Original description",
      objective: "Original objective",
      status: "draft",
    },
    blocks: [
      {
        externalId: "integration-base",
        name: "Base",
        objective: "",
        position: 1,
        durationWeeks: 1,
        slots: [{ externalId: "integration-base-slot", weekday: 1, position: 1, label: "Climbing" }],
        weeks: [
          {
            externalId: "integration-base-week-1",
            position: 1,
            label: "",
            focus: "Technique",
            weekType: "normal",
            prescriptions: [
              {
                slotExternalId: "integration-base-slot",
                workout: {
                  title: "Base session",
                  sessionType: "climbing",
                  description: "",
                  notes: "",
                  plannedDurationMin: 60,
                  plannedIntensity: "moderate",
                  components: [{ name: "Warm-up", instructions: "", durationMin: 10, targets: null }],
                },
              },
            ],
          },
        ],
      },
      {
        externalId: "integration-build",
        name: "Build",
        objective: "",
        position: 2,
        durationWeeks: 1,
        slots: [{ externalId: "integration-build-slot", weekday: 3, position: 1, label: "Strength" }],
        weeks: [
          {
            externalId: "integration-build-week-1",
            position: 1,
            label: "",
            focus: "Power",
            weekType: "normal",
            prescriptions: [
              {
                slotExternalId: "integration-build-slot",
                workout: {
                  title: "Build session",
                  sessionType: "strength",
                  description: "",
                  notes: "",
                  plannedDurationMin: 45,
                  plannedIntensity: "hard",
                  components: [{ name: "Main set", instructions: "", durationMin: 20, targets: null }],
                },
              },
            ],
          },
        ],
      },
    ],
  },
});

const previewImport = (client, document) =>
  client.send("/api/paideuo/v1/imports/preview", { method: "POST", body: document });

const commitImport = (client, document, previewToken) =>
  client.send("/api/paideuo/v1/imports/commit", {
    method: "POST",
    body: { document, previewToken },
  });

const createAuthedUser = async (admin, baseUrl, suffix) => {
  const email = `imports-integration-${suffix}@example.com`;
  const password = "Password123!";
  await admin.collection("paideuo_users").create({ email, password, passwordConfirm: password });
  const client = new PocketBase(baseUrl);
  await client.collection("paideuo_users").authWithPassword(email, password);
  return { client, userId: client.authStore.record.id };
};

test("PocketBase-backed hierarchy imports are transactional and schedule-safe", async () => {
  const fixtureSample = JSON.parse(fs.readFileSync(sampleProgramPath, "utf8"));
  assert.equal(fixtureSample.kind, "program");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paideuo-imports-it-"));
  const dataDir = path.join(tempRoot, "pb_data");
  const hooksDir = path.join(tempRoot, "pb_hooks");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.cpSync(baseHooksDir, hooksDir, { recursive: true });
  fs.writeFileSync(
    path.join(hooksDir, injectedFailureHookName),
    `onRecordValidate((event) => {
  if (event.record.getString("name") === "${injectedFailureMarker}") {
    throw new BadRequestError("Injected nested write failure.");
  }
  event.next();
}, "paideuo_training_components");
`,
    "utf8",
  );

  const superuserEmail = "imports-it-superuser@example.com";
  const superuserPassword = "Password123!";
  pocketbaseCreateOrUpdateSuperuser(dataDir, hooksDir, superuserEmail, superuserPassword);

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(
    "pocketbase",
    [
      "serve",
      `--http=127.0.0.1:${port}`,
      `--dir=${dataDir}`,
      `--migrationsDir=${migrationsDir}`,
      `--hooksDir=${hooksDir}`,
      "--hooksWatch=false",
    ],
    { cwd: repoRoot, stdio: "pipe" },
  );

  try {
    await waitForHealth(baseUrl, 20000, server);

    const admin = new PocketBase(baseUrl);
    await admin.collection("_superusers").authWithPassword(superuserEmail, superuserPassword);

    const owner = await createAuthedUser(admin, baseUrl, "owner");
    const intruder = await createAuthedUser(admin, baseUrl, "intruder");

    const initialDocument = makeProgramDocument();
    const initialPreview = await previewImport(owner.client, initialDocument);
    assert.equal(initialPreview.conflicting, 0);
    const initialCommit = await commitImport(
      owner.client,
      initialDocument,
      initialPreview.previewToken,
    );
    assert.equal(initialCommit.committed, true);
    assert.ok(initialCommit.rows.programId);
    assert.equal(initialCommit.rows.scheduleSynchronization, null);

    const createdProgram = await admin.collection("paideuo_programs").getOne(initialCommit.rows.programId);
    assert.equal(createdProgram.external_id, "integration-program");
    const createdBlocks = await admin.collection("paideuo_blocks").getFullList({
      filter: `program = "${createdProgram.id}"`,
      sort: "position",
    });
    assert.equal(createdBlocks.length, 2);
    const allWeeks = await admin.collection("paideuo_program_weeks").getFullList();
    const programBlockIds = new Set(createdBlocks.map((row) => row.id));
    const weekIds = new Set(
      allWeeks.filter((row) => programBlockIds.has(row.block)).map((row) => row.id),
    );
    const programPrescriptions = (
      await admin.collection("paideuo_session_prescriptions").getFullList()
    ).filter((row) => weekIds.has(row.program_week));
    assert.ok(programPrescriptions.length > 0);

    const repeatPreview = await previewImport(owner.client, initialDocument);
    assert.ok(repeatPreview.items.every((item) => item.status === "skip"));
    const repeatCommit = await commitImport(owner.client, initialDocument, repeatPreview.previewToken);
    assert.equal(repeatCommit.rows.unchanged, true);

    const skipSafetyDocument = structuredClone(initialDocument);
    skipSafetyDocument.data.program.description = "Program-only change";
    const trackedPrescriptionId = programPrescriptions[0].id;
    const trackedBefore = await admin
      .collection("paideuo_session_prescriptions")
      .getOne(trackedPrescriptionId);
    const skipSafetyPreview = await previewImport(owner.client, skipSafetyDocument);
    assert.ok(
      skipSafetyPreview.items
        .filter((item) => item.type === "prescription")
        .every((item) => item.status === "skip"),
    );
    await commitImport(owner.client, skipSafetyDocument, skipSafetyPreview.previewToken);
    const trackedAfter = await admin
      .collection("paideuo_session_prescriptions")
      .getOne(trackedPrescriptionId);
    assert.equal(trackedAfter.updated, trackedBefore.updated);

    const updatedDocument = structuredClone(skipSafetyDocument);
    updatedDocument.data.program.description = "Updated description";
    updatedDocument.data.blocks[0].weeks[0].prescriptions[0].workout.components[0].instructions =
      "Updated instructions";
    const updatePreview = await previewImport(owner.client, updatedDocument);
    const updateCommit = await commitImport(owner.client, updatedDocument, updatePreview.previewToken);
    assert.equal(updateCommit.committed, true);
    const updatedProgram = await admin.collection("paideuo_programs").getOne(createdProgram.id);
    assert.equal(updatedProgram.description, "Updated description");

    const swappedDocument = structuredClone(updatedDocument);
    swappedDocument.data.blocks[0].position = 2;
    swappedDocument.data.blocks[1].position = 1;
    const blockBeforeSwap = new Map(
      (await admin.collection("paideuo_blocks").getFullList({ filter: `program = "${createdProgram.id}"` })).map(
        (row) => [row.external_id, { id: row.id, position: row.position }],
      ),
    );
    const swapPreview = await previewImport(owner.client, swappedDocument);
    await commitImport(owner.client, swappedDocument, swapPreview.previewToken);
    const blockAfterSwap = new Map(
      (await admin.collection("paideuo_blocks").getFullList({ filter: `program = "${createdProgram.id}"` })).map(
        (row) => [row.external_id, { id: row.id, position: row.position }],
      ),
    );
    assert.equal(blockAfterSwap.get("integration-base").id, blockBeforeSwap.get("integration-base").id);
    assert.equal(blockAfterSwap.get("integration-build").id, blockBeforeSwap.get("integration-build").id);
    assert.equal(blockAfterSwap.get("integration-base").position, 2);
    assert.equal(blockAfterSwap.get("integration-build").position, 1);

    const prescriptions = (await admin.collection("paideuo_session_prescriptions").getFullList()).filter(
      (row) => weekIds.has(row.program_week),
    );
    assert.ok(prescriptions.length > 0);
    const schedule = await admin.collection("paideuo_program_schedules").create({
      program: createdProgram.id,
      start_date: "2026-11-01",
      timezone: "UTC",
      source_revision: "it",
      status: "active",
    });
    const scheduledSession = await admin.collection("paideuo_scheduled_sessions").create({
      schedule: schedule.id,
      source_prescription_id: prescriptions[0].id,
      scheduled_date: "2026-11-21",
      original_date: "2026-11-21",
      program_date: "2026-11-21",
      slot_position: 1,
      prescription_snapshot: { title: "Snapshot" },
      status: "planned",
      manually_moved: false,
      source_removal_acknowledged: false,
      manually_edited: false,
      deleted: false,
    });

    const scheduleUpdateDocument = structuredClone(swappedDocument);
    scheduleUpdateDocument.data.program.objective = "Updated objective";
    const schedulePreview = await previewImport(owner.client, scheduleUpdateDocument);
    const scheduleCommit = await commitImport(
      owner.client,
      scheduleUpdateDocument,
      schedulePreview.previewToken,
    );
    assert.equal(scheduleCommit.rows.scheduleSynchronization, "review-required");
    const persistedSession = await admin
      .collection("paideuo_scheduled_sessions")
      .getOne(scheduledSession.id);
    assert.equal(persistedSession.scheduled_date, "2026-11-21");
    assert.equal(persistedSession.status, "planned");

    const unauthorizedDocument = structuredClone(initialDocument);
    unauthorizedDocument.data.program.id = createdProgram.id;
    await assert.rejects(
      () => previewImport(intruder.client, unauthorizedDocument),
      (error) => error?.status === 400 && /Unauthorized program id/.test(error?.response?.message ?? ""),
    );

    const beforeFailure = await admin.collection("paideuo_programs").getOne(createdProgram.id);
    const failureDocument = structuredClone(scheduleUpdateDocument);
    failureDocument.data.program.description = "Should roll back";
    failureDocument.data.blocks[0].weeks[0].prescriptions[0].workout.components[0].name =
      injectedFailureMarker;
    const failurePreview = await previewImport(owner.client, failureDocument);
    await assert.rejects(
      () => commitImport(owner.client, failureDocument, failurePreview.previewToken),
      (error) => error?.status === 400 && /Injected nested write failure/.test(error?.response?.message ?? ""),
    );
    const afterFailure = await admin.collection("paideuo_programs").getOne(createdProgram.id);
    assert.equal(afterFailure.description, beforeFailure.description);
    const componentRows = await admin.collection("paideuo_training_components").getFullList({
      filter: `name = "${injectedFailureMarker}"`,
    });
    assert.equal(componentRows.length, 0);
  } finally {
    if (server.exitCode === null) server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
