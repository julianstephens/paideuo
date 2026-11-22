/* oxlint-disable import/no-commonjs */
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
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

const pocketbaseCreateOrUpdateSuperuser = (dataDir, hooksDir, email, password, migrations) => {
  const result = spawnSync(
    "pocketbase",
    [
      "superuser",
      "upsert",
      email,
      password,
      `--dir=${dataDir}`,
      `--migrationsDir=${migrations}`,
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
        slots: [
          { externalId: "integration-base-slot", weekday: 1, position: 1, label: "Climbing" },
        ],
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
                  components: [
                    {
                      key: "warm-up",
                      name: "Warm-up",
                      instructions: "",
                      durationMin: 10,
                      targets: null,
                    },
                  ],
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
        slots: [
          { externalId: "integration-build-slot", weekday: 3, position: 1, label: "Strength" },
        ],
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
                  components: [
                    {
                      key: "main-set",
                      name: "Main set",
                      instructions: "",
                      durationMin: 20,
                      targets: null,
                    },
                  ],
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

const commitImport = (client, document, previewToken, metadata = {}) =>
  client.send("/api/paideuo/v1/imports/commit", {
    method: "POST",
    body: { document, previewToken, ...metadata },
  });

const domainRequest = (client, path, body) =>
  client.send("/api/paideuo/v1/" + path, { method: "POST", body });

const serviceImportRequest = async (baseUrl, path, token, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(payload?.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.response = payload;
    throw error;
  }
  return payload;
};

const servicePreviewImport = (baseUrl, token, document) =>
  serviceImportRequest(baseUrl, "/api/paideuo/v1/imports/service/preview", token, document);

const serviceCommitImport = (baseUrl, token, document, previewToken, metadata = {}) =>
  serviceImportRequest(baseUrl, "/api/paideuo/v1/imports/service/commit", token, {
    document,
    previewToken,
    ...metadata,
  });

const createAuthedUser = async (admin, baseUrl, suffix) => {
  const email = `imports-integration-${suffix}@example.com`;
  const password = "Password123!";
  await admin.collection("paideuo_users").create({ email, password, passwordConfirm: password });
  const client = new PocketBase(baseUrl);
  client.autoCancellation(false);
  await client.collection("paideuo_users").authWithPassword(email, password);
  return { client, userId: client.authStore.record.id };
};

const withPocketBase = async (run, { pendingMigration, env } = {}) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paideuo-imports-it-"));
  const dataDir = path.join(tempRoot, "pb_data");
  const hooksDir = path.join(tempRoot, "pb_hooks");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.cpSync(baseHooksDir, hooksDir, { recursive: true });
  const migrations = pendingMigration ? path.join(tempRoot, "pb_migrations") : migrationsDir;
  if (pendingMigration) {
    fs.cpSync(migrationsDir, migrations, {
      recursive: true,
      filter: (source) => path.basename(source) !== pendingMigration,
    });
  }
  fs.writeFileSync(
    path.join(hooksDir, injectedFailureHookName),
    `onRecordValidate((event) => {
  if (event.record.getString("name") === "${injectedFailureMarker}") {
    throw new BadRequestError("Injected nested write failure.");
  }
  event.next();
}, "paideuo_training_components");
onRecordValidate((event) => {
  if (event.record.getString("measurements").includes("__INJECT_NESTED_FAIL__")) {
    throw new BadRequestError("Injected check-in write failure.");
  }
  event.next();
}, "paideuo_daily_recovery");
onRecordValidate((event) => {
  if (event.record.getString("notes") === "${injectedFailureMarker}") {
    throw new BadRequestError("Injected component result write failure.");
  }
  event.next();
}, "paideuo_workout_component_results");
`,
    "utf8",
  );

  const superuserEmail = "imports-it-superuser@example.com";
  const superuserPassword = "Password123!";
  pocketbaseCreateOrUpdateSuperuser(
    dataDir,
    hooksDir,
    superuserEmail,
    superuserPassword,
    migrations,
  );

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const startServer = () =>
    spawn(
      "pocketbase",
      [
        "serve",
        `--http=127.0.0.1:${port}`,
        `--dir=${dataDir}`,
        `--migrationsDir=${migrations}`,
        `--hooksDir=${hooksDir}`,
        "--hooksWatch=false",
        "--automigrate=false",
      ],
      { cwd: repoRoot, stdio: "pipe", env: { ...process.env, ...env } },
    );
  const stopServer = async (processRef) => {
    await new Promise((resolve) => {
      if (processRef.exitCode !== null) {
        resolve();
        return;
      }
      processRef.once("exit", resolve);
      processRef.kill("SIGTERM");
    });
  };
  let server = startServer();

  try {
    await waitForHealth(baseUrl, 20000, server);

    const admin = new PocketBase(baseUrl);
    await admin.collection("_superusers").authWithPassword(superuserEmail, superuserPassword);

    const restart = async () => {
      await stopServer(server);
      server = startServer();
      await waitForHealth(baseUrl, 20000, server);
    };
    const upgrade = async () => {
      fs.copyFileSync(
        path.join(migrationsDir, pendingMigration),
        path.join(migrations, pendingMigration),
      );
      await restart();
    };
    await run({ admin, baseUrl, restart, upgrade });
  } finally {
    if (server.exitCode === null) await stopServer(server);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
};

test("Library imports reconcile templates and snapshot program baselines", async () => {
  await withPocketBase(async ({ admin, baseUrl }) => {
    const { client } = await createAuthedUser(admin, baseUrl, "library-owner");
    const { client: other } = await createAuthedUser(admin, baseUrl, "library-other");
    const library = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "docs", "examples", "import-v1-session-templates.json"),
        "utf8",
      ),
    );
    const importDocument = async (document) => {
      const preview = await previewImport(client, document);
      return commitImport(client, document, preview.previewToken);
    };
    assert.equal((await importDocument(library)).rows[0].status, "created");
    assert.equal((await importDocument(library)).rows[0].status, "skipped");

    const program = makeProgramDocument();
    const [block] = program.data.blocks;
    block.slots[0].templateExternalId = "easy-run";
    const foreignPreview = await previewImport(other, program);
    assert.equal(foreignPreview.items.find(({ type }) => type === "slot").status, "conflict");
    const programPreview = await previewImport(client, program);
    assert.match(programPreview.items.find(({ type }) => type === "slot").detail, /Easy run/);
    program.data.templateWorkoutKeys = [
      programPreview.items.find(({ type }) => type === "prescription").key,
    ];
    const selectedPreview = await previewImport(client, program);
    assert.equal(
      selectedPreview.items.find(({ type }) => type === "session-template").label,
      "Base session",
    );

    library.data.templates[0].plannedDurationMax = 45;
    assert.equal((await importDocument(library)).rows[0].status, "updated");
    await assert.rejects(
      commitImport(client, program, selectedPreview.previewToken),
      (error) => error.status === 409 && /stale/.test(error.response.message),
    );

    const committed = await importDocument(program);
    assert.equal(committed.rows.templates[0].status, "created");
    const repeated = await importDocument(program);
    assert.equal(repeated.rows.templates[0].status, "skipped");
    assert.equal(repeated.rows.unchanged, true);
    const templates = await client.send("/api/paideuo/templates", { method: "GET" });
    assert.equal(templates.length, 2);
    assert.ok(templates.some(({ externalId }) => externalId === "easy-run"));

    const rejectedProgram = structuredClone(program);
    const rejectedWorkout = rejectedProgram.data.blocks[0].weeks[0].prescriptions[0].workout;
    rejectedWorkout.title = "Rejected template update";
    rejectedWorkout.components[0].name = injectedFailureMarker;
    await assert.rejects(
      importDocument(rejectedProgram),
      (error) =>
        error.status === 400 && /Injected nested write failure/.test(error.response.message),
    );
    const afterRollback = await client.send("/api/paideuo/templates", { method: "GET" });
    assert.ok(afterRollback.some(({ name }) => name === "Base session"));
    assert.ok(afterRollback.every(({ name }) => name !== rejectedWorkout.title));

    library.data.templates[0].plannedDurationMax = 50;
    await importDocument(library);
    const readSlot = () =>
      admin
        .collection("paideuo_session_slots")
        .getFirstListItem(admin.filter("external_id = {:key}", { key: block.slots[0].externalId }));
    assert.equal((await readSlot()).baseline.plannedDurationMax, 45);
    delete block.slots[0].templateExternalId;
    await importDocument(program);
    assert.equal((await readSlot()).baseline.name, "Easy run");
    block.slots[0].templateExternalId = null;
    await importDocument(program);
    assert.equal((await readSlot()).baseline, null);
  });
});

test("PocketBase-backed hierarchy imports are transactional and schedule-safe", async () => {
  const fixtureSample = JSON.parse(fs.readFileSync(sampleProgramPath, "utf8"));
  assert.equal(fixtureSample.kind, "program");

  await withPocketBase(async ({ admin, baseUrl, restart }) => {
    const owner = await createAuthedUser(admin, baseUrl, "owner");
    const intruder = await createAuthedUser(admin, baseUrl, "intruder");

    const initialDocument = makeProgramDocument();
    const domainProgramBody = {
      ...structuredClone(initialDocument.data),
      operationId: "domain-program",
    };
    delete domainProgramBody.blocks[0].weeks[0].prescriptions[0].workout.components[0].key;
    const domainProgram = await domainRequest(intruder.client, "programs", domainProgramBody);
    assert.equal(domainProgram.created, 1);
    assert.equal(domainProgram.rows[0].status, "created");
    const domainProgramRecord = await admin
      .collection("paideuo_programs")
      .getOne(domainProgram.rows[0].programId);
    assert.equal(domainProgramRecord.owner, intruder.userId);
    assert.equal(domainProgramRecord.external_id, initialDocument.data.program.externalId);

    const defaultKeyComponent = await admin
      .collection("paideuo_training_components")
      .getFirstListItem(
        admin.filter('prescription.program_week.block.program = {:program} && name = "Warm-up"', {
          program: domainProgramRecord.id,
        }),
      );
    assert.equal(defaultKeyComponent.external_key, "component-1");

    const conflictingProgram = structuredClone(initialDocument.data);
    conflictingProgram.program.description = "Must roll back";
    conflictingProgram.blocks = [conflictingProgram.blocks[0]];
    conflictingProgram.blocks[0].position = 2;
    await assert.rejects(
      () => domainRequest(intruder.client, "programs", conflictingProgram),
      (error) => {
        assert.equal(error.status, 409);
        assert.equal(error.response.rolledBack, true);
        assert.equal(error.response.error, 1);
        const conflict = error.response.rows.find((row) => row.status === "conflict");
        assert.equal(conflict.key, conflictingProgram.blocks[0].externalId);
        assert.ok(error.response.rows.some((row) => row.status === "not_committed"));
        return true;
      },
    );
    assert.equal(
      (await admin.collection("paideuo_programs").getOne(domainProgramRecord.id)).description,
      domainProgramRecord.description,
    );

    const initialPreview = await previewImport(owner.client, initialDocument);
    assert.equal(initialPreview.conflicting, 0);
    const initialCommit = await commitImport(
      owner.client,
      initialDocument,
      initialPreview.previewToken,
      {
        operationId: "integration-program-001",
        sourceLabel: "integration-test",
        importTimestamp: "2026-11-20T21:50:13Z",
      },
    );
    assert.equal(initialCommit.committed, true);
    assert.ok(initialCommit.rows.programId);
    assert.equal(initialCommit.rows.scheduleSynchronization, null);
    assert.equal(initialCommit.audit.summary.programs, 1);
    assert.ok(initialCommit.audit.summary.created > 0);

    await restart();
    assert.deepEqual(
      await domainRequest(intruder.client, "programs", domainProgramBody),
      domainProgram,
    );
    await assert.rejects(
      () =>
        domainRequest(intruder.client, "programs", {
          ...domainProgramBody,
          program: { ...domainProgramBody.program, name: "Different name" },
        }),
      (error) => error?.status === 409,
    );
    assert.equal(
      (await admin.collection("paideuo_programs").getOne(domainProgramRecord.id)).updated,
      domainProgramRecord.updated,
    );
    const restartedReplay = await commitImport(
      owner.client,
      initialDocument,
      "preview-state-does-not-survive-restart",
      { operationId: "integration-program-001" },
    );
    assert.deepEqual(restartedReplay, initialCommit);

    const createdProgram = await admin
      .collection("paideuo_programs")
      .getOne(initialCommit.rows.programId);
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
    const repeatCommit = await commitImport(
      owner.client,
      initialDocument,
      repeatPreview.previewToken,
    );
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
    const updateCommit = await commitImport(
      owner.client,
      updatedDocument,
      updatePreview.previewToken,
    );
    assert.equal(updateCommit.committed, true);
    const updatedProgram = await admin.collection("paideuo_programs").getOne(createdProgram.id);
    assert.equal(updatedProgram.description, "Updated description");

    const identityDocument = structuredClone(updatedDocument);
    const workout = identityDocument.data.blocks[0].weeks[0].prescriptions[0].workout;
    const prescriptionId = updatePreview.items.find(
      (item) => item.type === "prescription" && item.status === "update",
    ).id;
    const trainingComponents = () =>
      admin.collection("paideuo_training_components").getFullList({
        filter: admin.filter("prescription = {:id}", { id: prescriptionId }),
        sort: "position",
      });
    const [warmup] = await trainingComponents();
    const mainSet = { key: "climb drill", name: "Climb", targets: null };
    workout.components = [mainSet, ...workout.components];
    const importIdentityDocument = async () => {
      const preview = await previewImport(owner.client, identityDocument);
      return commitImport(owner.client, identityDocument, preview.previewToken);
    };
    await importIdentityDocument();
    const [climb, movedWarmup] = await trainingComponents();
    assert.equal(movedWarmup.id, warmup.id);
    assert.equal(movedWarmup.position, 2);
    assert.equal(climb.external_key, mainSet.key);

    workout.components.reverse();
    await importIdentityDocument();
    assert.deepEqual(
      (await trainingComponents()).map((row) => row.id),
      [warmup.id, climb.id],
    );

    delete workout.components[1].key;
    const keyless = await previewImport(owner.client, identityDocument);
    assert.equal(keyless.conflicting, 1);
    assert.match(
      keyless.items.find((item) => item.status === "conflict").error,
      /explicit component keys/,
    );
    await assert.rejects(
      () => commitImport(owner.client, identityDocument, keyless.previewToken),
      (error) => error.status === 409,
    );
    assert.deepEqual(
      (await trainingComponents()).map((row) => row.id),
      [warmup.id, climb.id],
    );

    workout.components.pop();
    await importIdentityDocument();
    assert.deepEqual(
      (await trainingComponents()).map((row) => row.id),
      [warmup.id],
    );

    const prescription = await admin
      .collection("paideuo_session_prescriptions")
      .getOne(prescriptionId);
    const week = await admin.collection("paideuo_program_weeks").getOne(prescription.program_week);
    const cellPath = `/api/paideuo/programs/${createdProgram.id}/blocks/${week.block}/weeks/${week.id}/cells/${prescription.slot}`;
    const cell = await owner.client.send(cellPath);
    const editCell = (current, components) =>
      owner.client.send(cellPath, {
        method: "PATCH",
        body: { ...current.prescription, revision: current.revision, components },
      });
    await editCell(cell, [mainSet, ...cell.prescription.components]);
    const [editorClimb, editorWarmup] = await trainingComponents();
    assert.equal(editorWarmup.id, warmup.id);
    const editedCell = await owner.client.send(cellPath);
    await editCell(editedCell, [...editedCell.prescription.components].reverse());
    assert.deepEqual(
      (await trainingComponents()).map((row) => row.id),
      [warmup.id, editorClimb.id],
    );
    const reorderedCell = await owner.client.send(cellPath);
    await editCell(reorderedCell, reorderedCell.prescription.components.slice(0, 1));
    assert.deepEqual(
      (await trainingComponents()).map((row) => row.id),
      [warmup.id],
    );

    const swappedDocument = structuredClone(updatedDocument);
    swappedDocument.data.blocks[0].position = 2;
    swappedDocument.data.blocks[1].position = 1;
    const blockBeforeSwap = new Map(
      (
        await admin
          .collection("paideuo_blocks")
          .getFullList({ filter: `program = "${createdProgram.id}"` })
      ).map((row) => [row.external_id, { id: row.id, position: row.position }]),
    );
    const swapPreview = await previewImport(owner.client, swappedDocument);
    await commitImport(owner.client, swappedDocument, swapPreview.previewToken);
    const blockAfterSwap = new Map(
      (
        await admin
          .collection("paideuo_blocks")
          .getFullList({ filter: `program = "${createdProgram.id}"` })
      ).map((row) => [row.external_id, { id: row.id, position: row.position }]),
    );
    assert.equal(
      blockAfterSwap.get("integration-base").id,
      blockBeforeSwap.get("integration-base").id,
    );
    assert.equal(
      blockAfterSwap.get("integration-build").id,
      blockBeforeSwap.get("integration-build").id,
    );
    assert.equal(blockAfterSwap.get("integration-base").position, 2);
    assert.equal(blockAfterSwap.get("integration-build").position, 1);

    const schedule = await admin.collection("paideuo_program_schedules").create({
      program: createdProgram.id,
      start_date: "2026-11-01",
      timezone: "UTC",
      source_revision: "it",
      status: "active",
    });
    const scheduledSession = await admin.collection("paideuo_scheduled_sessions").create({
      schedule: schedule.id,
      source_prescription_id: prescriptionId,
      scheduled_date: "2026-11-21",
      original_date: "2026-11-21",
      program_date: "2026-11-21",
      slot_position: 1,
      prescription_snapshot: {
        title: "Snapshot",
        components: [{ key: warmup.external_key, name: warmup.name }],
      },
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

    const workoutDocument = {
      schema: "paideuo",
      version: 1,
      kind: "workout-component-results",
      data: {
        sourceSessionId: scheduledSession.id,
        sourceWorkoutKey: "integration-workout-result",
        completedDate: "2026-11-20",
        actualDurationMin: 58,
        sessionRpe: 7,
        notes: "Completed",
        components: [
          {
            key: warmup.external_key,
            plannedPosition: 1,
            name: warmup.name,
            completed: true,
            rpe: 6,
          },
        ],
      },
    };
    const workoutPath = "workouts/results/batch";
    for (const sourceWorkoutKey of [workoutDocument.data.sourceWorkoutKey, "alias-key"]) {
      await assert.rejects(
        () =>
          domainRequest(owner.client, workoutPath, {
            results: [workoutDocument.data, { ...workoutDocument.data, sourceWorkoutKey }],
          }),
        (error) => {
          assert.equal(error.status, 409);
          assert.equal(error.response.rolledBack, true);
          assert.equal(error.response.error, 2);
          assert.ok(error.response.rows.every((row) => row.code === "duplicate_target"));
          return true;
        },
      );
    }
    assert.deepEqual(
      await admin.collection("paideuo_session_completions").getFullList({
        filter: admin.filter("session = {:id}", { id: scheduledSession.id }),
      }),
      [],
    );
    const workoutPreview = await previewImport(owner.client, workoutDocument);
    const workoutCommit = await commitImport(
      owner.client,
      workoutDocument,
      workoutPreview.previewToken,
      { operationId: "integration-workout-001" },
    );
    assert.equal(workoutCommit.audit.summary.committed, 1);

    const calendarSession = async () => {
      const sessions = await owner.client.send(
        "/api/paideuo/calendar?start=2026-11-21&end=2026-11-21",
      );
      return sessions.find((session) => session.id === scheduledSession.id);
    };
    const historicalSession = await calendarSession();
    assert.equal(historicalSession.status, "completed");
    assert.equal(historicalSession.componentResults[0].rpe, 6);
    const beforeHistoricalEdit = await owner.client.send(cellPath);
    await editCell(beforeHistoricalEdit, [
      mainSet,
      { ...beforeHistoricalEdit.prescription.components[0], name: "Revised warm-up" },
    ]);
    assert.deepEqual(await calendarSession(), historicalSession);

    const replacementDocument = structuredClone(workoutDocument);
    replacementDocument.data.notes = "Replacement";
    replacementDocument.data.replaceExistingCompletion = true;
    await assert.rejects(
      () => domainRequest(owner.client, workoutPath, { results: [replacementDocument.data] }),
      (error) => error?.status === 409 && error.response.rows[0].status === "conflict",
    );

    const hrBody = {
      sourceSessionId: scheduledSession.id,
      sourceWorkoutKey: workoutDocument.data.sourceWorkoutKey,
      externalId: "sensor-domain-test",
      startedAt: "2026-11-20T21:00:00Z",
      endedAt: "2026-11-20T21:58:00Z",
      timezone: "UTC",
      units: "bpm",
      operationId: "domain-recording",
    };
    const hrPath = "heart-rate/recordings/attach";
    const [hr, concurrentHr] = await Promise.all([
      domainRequest(owner.client, hrPath, hrBody),
      domainRequest(owner.client, hrPath, hrBody),
    ]);
    assert.equal(hr.created, 1);
    assert.deepEqual(concurrentHr, hr);
    assert.deepEqual(await domainRequest(owner.client, hrPath, hrBody), hr);
    const recordings = await admin.collection("paideuo_heart_rate_recordings").getFullList({
      filter: admin.filter("owner = {:id}", { id: owner.userId }),
    });
    assert.equal(recordings.length, 1);
    assert.equal(recordings[0].session, scheduledSession.id);

    const replacementPreview = await previewImport(owner.client, replacementDocument);
    assert.equal(replacementPreview.conflicting, 1);
    await assert.rejects(
      () => commitImport(owner.client, replacementDocument, replacementPreview.previewToken),
      (error) => error?.status === 409,
    );

    const concurrentDocument = {
      schema: "paideuo",
      version: 1,
      kind: "daily-check-ins",
      data: {
        entries: [
          {
            date: "2026-11-20",
            recovery: { sleepHours: 8 },
            nutrition: { proteinGrams: 140 },
          },
        ],
      },
    };
    const credentialListPath = "/api/paideuo/v1/service-credentials";
    const emptyCredentialList = await owner.client.send(credentialListPath);
    assert.deepEqual(emptyCredentialList.credentials, []);
    assert.ok(emptyCredentialList.availableScopes.includes("imports:commit"));

    const scopeDenied = await owner.client.send("/api/paideuo/v1/service-credentials/issue", {
      method: "POST",
      body: { label: "scope-denied", scopes: ["imports:commit"], expiresAt: "" },
    });
    await assert.rejects(
      () => servicePreviewImport(baseUrl, scopeDenied.plaintextToken, concurrentDocument),
      (error) => error?.status === 403 && /metrics:write/.test(error?.response?.message ?? ""),
    );

    const checkInPath = "check-ins/upsert";
    await assert.rejects(
      () =>
        serviceImportRequest(
          baseUrl,
          "/api/paideuo/v1/service/" + checkInPath,
          scopeDenied.plaintextToken,
          concurrentDocument.data,
        ),
      (error) => error?.status === 403 && /metrics:write/.test(error?.response?.message ?? ""),
    );

    const checkInDate = "2026-10-11";
    const submitCheckIn = (entry, operationId) =>
      domainRequest(owner.client, checkInPath, {
        entries: [{ date: checkInDate, ...entry }],
        operationId,
      });
    await submitCheckIn(
      {
        recovery: { sleepHours: 8, notes: "Keep notes" },
        nutrition: { proteinGrams: 140 },
      },
      "domain-check-in-create",
    );
    const checkInPatch = { recovery: { sleepHours: null } };
    const patched = await submitCheckIn(checkInPatch, "domain-check-in-patch");
    assert.equal(patched.updated, 1);
    const [checkIn] = await admin.collection("paideuo_daily_recovery").getFullList({
      filter: admin.filter("owner = {:owner} && date = {:date}", {
        owner: owner.userId,
        date: checkInDate,
      }),
    });
    assert.equal(checkIn.measurements.sleepHours, null);
    assert.equal(checkIn.measurements.notes, "Keep notes");
    assert.equal(checkIn.nutrition.proteinGrams, 140);
    await assert.rejects(
      () => submitCheckIn({ recovery: {} }, "domain-check-in-patch"),
      (error) => error?.status === 409,
    );
    await submitCheckIn({ recovery: { sleepHours: 6 } }, "domain-check-in-later");
    assert.deepEqual(await submitCheckIn(checkInPatch, "domain-check-in-patch"), patched);
    assert.equal(
      (await admin.collection("paideuo_daily_recovery").getOne(checkIn.id)).measurements.sleepHours,
      6,
    );

    const rollbackDate = "2026-10-12";
    const validEntry = { date: rollbackDate, recovery: { sleepHours: 7 } };
    for (const [badEntry, status, code] of [
      [{ date: "2026-10-13", recovery: { sleepHours: 50 } }, 400, "invalid_item"],
      [{ date: "2026-10-13", recovery: { notes: injectedFailureMarker } }, 409, "write_failed"],
    ]) {
      const operationId = "domain-check-in-" + code;
      await assert.rejects(
        () =>
          domainRequest(owner.client, checkInPath, {
            entries: [validEntry, badEntry],
            operationId,
          }),
        (error) => {
          assert.equal(error.status, status);
          assert.equal(error.response.rolledBack, true);
          assert.equal(error.response.error, 1);
          assert.equal(error.response.created, 0);
          assert.equal(error.response.rows[0].status, "not_committed");
          assert.equal(error.response.rows[1].key, badEntry.date);
          assert.equal(error.response.rows[1].code, code);
          assert.doesNotMatch(JSON.stringify(error.response), /Injected check-in write failure/);
          return true;
        },
      );
      assert.deepEqual(
        await admin.collection("paideuo_import_operations").getFullList({
          filter: admin.filter("operation_id = {:id}", { id: operationId }),
        }),
        [],
      );
      assert.deepEqual(
        await admin.collection("paideuo_daily_recovery").getFullList({
          filter: admin.filter("owner = {:owner} && (date = {:first} || date = {:second})", {
            owner: owner.userId,
            first: rollbackDate,
            second: badEntry.date,
          }),
        }),
        [],
      );
    }

    const tokenCredential = await owner.client.send("/api/paideuo/v1/service-credentials/issue", {
      method: "POST",
      body: {
        label: "ingestion-agent",
        scopes: ["imports:commit", "metrics:write", "workouts:write", "programs:write"],
        allowHistoryRewrite: true,
      },
    });
    const credentialList = await owner.client.send(credentialListPath);
    assert.equal(credentialList.credentials.length, 2);
    const listedCredential = credentialList.credentials.find(
      (credential) => credential.id === tokenCredential.credential.id,
    );
    assert.deepEqual(listedCredential, tokenCredential.credential);
    assert.ok(listedCredential.created);
    assert.deepEqual((await intruder.client.send(credentialListPath)).credentials, []);

    const tokenPreview = await servicePreviewImport(
      baseUrl,
      tokenCredential.plaintextToken,
      concurrentDocument,
    );
    const tokenCommit = await serviceCommitImport(
      baseUrl,
      tokenCredential.plaintextToken,
      concurrentDocument,
      tokenPreview.previewToken,
      { operationId: "integration-service-token-001" },
    );
    assert.equal(
      tokenCommit.audit.provenance.credentialRef,
      `service:${tokenCredential.credential.id}`,
    );

    const replacementWithTokenPreview = await servicePreviewImport(
      baseUrl,
      tokenCredential.plaintextToken,
      replacementDocument,
    );
    assert.equal(replacementWithTokenPreview.conflicting, 0);
    await serviceCommitImport(
      baseUrl,
      tokenCredential.plaintextToken,
      replacementDocument,
      replacementWithTokenPreview.previewToken,
    );

    const rewrittenCompletion = await admin
      .collection("paideuo_session_completions")
      .getFirstListItem(`session = "${scheduledSession.id}"`);
    assert.equal(rewrittenCompletion.notes, "Replacement");

    const domainReplacement = await serviceImportRequest(
      baseUrl,
      "/api/paideuo/v1/service/" + workoutPath,
      tokenCredential.plaintextToken,
      {
        operationId: "domain-workout-replacement",
        results: [{ ...replacementDocument.data, notes: "Domain replacement" }],
      },
    );
    assert.equal(domainReplacement.updated, 1);
    assert.equal(domainReplacement.audit.summary.updated, 1);
    assert.equal(
      (await admin.collection("paideuo_session_completions").getOne(rewrittenCompletion.id)).notes,
      "Domain replacement",
    );

    const intruderProgram = await admin.collection("paideuo_programs").create({
      owner: intruder.userId,
      name: "Intruder program",
      objective: "",
      description: "",
      status: "draft",
    });
    const ownerBoundProgramDocument = structuredClone(initialDocument);
    ownerBoundProgramDocument.data.program.id = intruderProgram.id;
    await assert.rejects(
      () =>
        servicePreviewImport(baseUrl, tokenCredential.plaintextToken, ownerBoundProgramDocument),
      (error) =>
        error?.status === 400 && /Unauthorized program id/.test(error?.response?.message ?? ""),
    );

    await owner.client.send(
      `/api/paideuo/v1/service-credentials/${tokenCredential.credential.id}/revoke`,
      {
        method: "POST",
      },
    );
    await assert.rejects(
      () => servicePreviewImport(baseUrl, tokenCredential.plaintextToken, concurrentDocument),
      (error) => error?.status === 401 && /revoked/.test(error?.response?.message ?? ""),
    );

    const expiredCredential = await owner.client.send("/api/paideuo/v1/service-credentials/issue", {
      method: "POST",
      body: {
        label: "expired-token",
        scopes: ["imports:commit", "metrics:write"],
      },
    });
    const expiredRecord = await admin
      .collection("paideuo_service_credentials")
      .update(expiredCredential.credential.id, { expires_at: "2000-01-01T00:00:00.000Z" });
    assert.equal(expiredRecord.expires_at, "2000-01-01T00:00:00.000Z");
    await assert.rejects(
      () => servicePreviewImport(baseUrl, expiredCredential.plaintextToken, concurrentDocument),
      (error) => error?.status === 401 && /expired/.test(error?.response?.message ?? ""),
    );
    const [concurrentPreviewA, concurrentPreviewB] = await Promise.all([
      previewImport(owner.client, concurrentDocument),
      previewImport(owner.client, concurrentDocument),
    ]);
    const [concurrentA, concurrentB] = await Promise.all([
      commitImport(owner.client, concurrentDocument, concurrentPreviewA.previewToken, {
        operationId: "integration-concurrent-001",
      }),
      commitImport(owner.client, concurrentDocument, concurrentPreviewB.previewToken, {
        operationId: "integration-concurrent-001",
      }),
    ]);
    assert.deepEqual(concurrentA, concurrentB);
    const concurrentRows = await admin.collection("paideuo_daily_recovery").getFullList({
      filter: `owner = "${owner.userId}" && date = "2026-11-20"`,
    });
    assert.equal(concurrentRows.length, 1);

    const conflictingDocument = structuredClone(concurrentDocument);
    conflictingDocument.data.entries[0].recovery.sleepHours = 7;
    await assert.rejects(
      () =>
        commitImport(owner.client, conflictingDocument, concurrentPreviewB.previewToken, {
          operationId: "integration-concurrent-001",
        }),
      (error) => error?.status === 409,
    );
    const rowsAfterConflict = await admin.collection("paideuo_daily_recovery").getFullList({
      filter: `owner = "${owner.userId}" && date = "2026-11-20"`,
    });
    assert.equal(rowsAfterConflict.length, 1);

    const unauthorizedDocument = structuredClone(initialDocument);
    unauthorizedDocument.data.program.id = createdProgram.id;
    await assert.rejects(
      () => previewImport(intruder.client, unauthorizedDocument),
      (error) =>
        error?.status === 400 && /Unauthorized program id/.test(error?.response?.message ?? ""),
    );

    const beforeFailure = await admin.collection("paideuo_programs").getOne(createdProgram.id);
    const failureDocument = structuredClone(scheduleUpdateDocument);
    failureDocument.data.program.description = "Should roll back";
    failureDocument.data.blocks[0].weeks[0].prescriptions[0].workout.components[0].name =
      injectedFailureMarker;
    const failurePreview = await previewImport(owner.client, failureDocument);
    await assert.rejects(
      () =>
        commitImport(owner.client, failureDocument, failurePreview.previewToken, {
          operationId: "integration-rollback-001",
        }),
      (error) =>
        error?.status === 400 &&
        /Injected nested write failure/.test(error?.response?.message ?? ""),
    );
    const afterFailure = await admin.collection("paideuo_programs").getOne(createdProgram.id);
    assert.equal(afterFailure.description, beforeFailure.description);
    const componentRows = await admin.collection("paideuo_training_components").getFullList({
      filter: `name = "${injectedFailureMarker}"`,
    });
    assert.equal(componentRows.length, 0);
    const failedReceipts = await admin.collection("paideuo_import_operations").getFullList({
      filter: 'operation_id = "integration-rollback-001"',
    });
    assert.equal(failedReceipts.length, 0);

    // Start the MCP scenarios with a fresh request-rate window for the same owner.
    await restart();

    const issueMcpCredential = async (scopes, allowHistoryRewrite = false) =>
      (
        await owner.client.send("/api/paideuo/v1/service-credentials/issue", {
          method: "POST",
          body: { label: "mcp-test", scopes, allowHistoryRewrite },
        })
      ).plaintextToken;
    const mcpRequest = (name, args) => ({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    });
    const callMcp = async (token, name, args) =>
      (
        await serviceImportRequest(
          baseUrl,
          "/api/paideuo/v1/service/mcp",
          token,
          mcpRequest(name, args),
        )
      ).result;
    const expectMcpError = (result, status) => {
      assert.equal(result.isError, true, JSON.stringify(result));
      assert.equal(result.structuredContent.status, status, JSON.stringify(result));
      return result.structuredContent.details;
    };
    const readOnly = await issueMcpCredential(["programs:read"]);
    const missingCommit = await issueMcpCredential([
      "programs:write",
      "workouts:write",
      "metrics:write",
    ]);
    const writer = await issueMcpCredential(
      ["imports:commit", "programs:read", "programs:write", "workouts:write", "metrics:write"],
      true,
    );
    const draftArgs = { name: "MCP draft", externalId: "mcp-draft", operationId: "mcp-draft-1" };
    for (const token of [readOnly, missingCommit]) {
      for (const [tool, args] of [
        ["create_draft", draftArgs],
        ["commit_import", { document: scheduleUpdateDocument, previewToken: "missing" }],
        ["record_workout", { data: workoutDocument.data }],
        ["submit_check_ins", { entries: [validEntry] }],
      ])
        expectMcpError(await callMcp(token, tool, args), 403);
    }

    const ownedRead = await callMcp(readOnly, "get_program", { id: createdProgram.id });
    assert.equal(ownedRead.isError, false);
    const readBlock = ownedRead.structuredContent.blocks.find(({ weeks }) =>
      weeks.some(({ prescriptions }) => prescriptions.length),
    );
    const readPrescription = readBlock.weeks.flatMap(({ prescriptions }) => prescriptions)[0];
    assert.ok(readBlock.slots.some(({ id }) => id === readPrescription.slotId));
    assert.ok(readPrescription.workout.components[0].name);
    expectMcpError(await callMcp(readOnly, "get_program", { id: intruderProgram.id }), 404);

    const draftResult = await callMcp(writer, "create_draft", draftArgs);
    assert.equal(draftResult.isError, false);
    assert.equal(draftResult.structuredContent.created, 1);
    assert.deepEqual(
      (await callMcp(writer, "create_draft", draftArgs)).structuredContent,
      draftResult.structuredContent,
    );
    const existingDraftConflict = expectMcpError(
      await callMcp(writer, "create_draft", {
        name: "Do not overwrite",
        externalId: scheduleUpdateDocument.data.program.externalId,
      }),
      409,
    );
    assert.equal(existingDraftConflict.rows[0].code, "program_exists");

    const change = structuredClone(scheduleUpdateDocument);
    change.data.program.description = "Approved MCP change";
    const mcpPreview = (await callMcp(writer, "preview_import", { document: change }))
      .structuredContent;
    assert.equal(mcpPreview.approvalRequired, true);
    const currentDescription = async () =>
      (await admin.collection("paideuo_programs").getOne(createdProgram.id)).description;
    assert.equal(await currentDescription(), beforeFailure.description);
    const commitArgs = { document: change, previewToken: mcpPreview.previewToken };
    expectMcpError(await callMcp(writer, "commit_import", commitArgs), 409);
    expectMcpError(
      await callMcp(writer, "commit_import", {
        ...commitArgs,
        approvedScheduledPlanChanges: true,
        approvalReceipt: "forged",
      }),
      409,
    );
    const humanMcp = await owner.client.send("/api/paideuo/v1/mcp", {
      method: "POST",
      body: mcpRequest("commit_import", commitArgs),
    });
    expectMcpError(humanMcp.result, 409);
    assert.equal(await currentDescription(), beforeFailure.description);
    await assert.rejects(
      () => domainRequest(intruder.client, "imports/approve", commitArgs),
      (error) => error.status === 409,
    );

    await assert.rejects(
      () => serviceImportRequest(baseUrl, "/api/paideuo/v1/imports/approve", writer, commitArgs),
      (error) => error.status === 401,
    );
    await assert.rejects(
      () => serviceCommitImport(baseUrl, writer, change, mcpPreview.previewToken),
      (error) => error.status === 409,
    );
    await assert.rejects(
      () => serviceImportRequest(baseUrl, "/api/paideuo/v1/service/programs", writer, change.data),
      (error) => error.status === 409 && error.response.rows[0].code === "approval_required",
    );

    const { approvalReceipt } = await domainRequest(owner.client, "imports/approve", commitArgs);
    const otherPreview = (await callMcp(writer, "preview_import", { document: change }))
      .structuredContent;
    expectMcpError(
      await callMcp(writer, "commit_import", {
        ...commitArgs,
        previewToken: otherPreview.previewToken,
        approvalReceipt,
      }),
      409,
    );
    const approvedCommit = await callMcp(writer, "commit_import", {
      ...commitArgs,
      approvalReceipt,
    });
    assert.equal(approvedCommit.isError, false, JSON.stringify(approvedCommit));
    assert.equal(approvedCommit.structuredContent.audit.summary.approval.approvedBy, owner.userId);
    assert.deepEqual(
      (await callMcp(writer, "commit_import", { ...commitArgs, approvalReceipt }))
        .structuredContent,
      approvedCommit.structuredContent,
    );
    assert.equal(await currentDescription(), change.data.program.description);
    const noOpPreview = (await callMcp(writer, "preview_import", { document: change }))
      .structuredContent;
    assert.equal(noOpPreview.approvalRequired, false);
    const noOpCommit = await callMcp(writer, "commit_import", {
      document: change,
      previewToken: noOpPreview.previewToken,
    });
    assert.equal(noOpCommit.structuredContent.rows.unchanged, true);
    expectMcpError(await callMcp(writer, "commit_import", { document: change }), 400);

    const laterChange = structuredClone(change);
    laterChange.data.program.objective = "A later MCP change";
    const laterPreview = (await callMcp(writer, "preview_import", { document: laterChange }))
      .structuredContent;
    const laterArgs = { document: laterChange, previewToken: laterPreview.previewToken };
    const laterApproval = await domainRequest(owner.client, "imports/approve", laterArgs);
    await admin.collection("paideuo_program_schedules").update(schedule.id, {
      source_revision: "new-schedule-revision",
    });
    expectMcpError(await callMcp(writer, "commit_import", { ...laterArgs, ...laterApproval }), 409);
    assert.equal(
      (await admin.collection("paideuo_programs").getOne(createdProgram.id)).objective,
      change.data.program.objective,
    );

    const draftProgramId = draftResult.structuredContent.rows[0].programId;
    await admin.collection("paideuo_programs").update(draftProgramId, { status: "completed" });
    const completedChange = {
      schema: "paideuo",
      version: 1,
      kind: "program",
      data: {
        program: { externalId: draftArgs.externalId, name: "New name", status: "completed" },
        blocks: [],
      },
    };
    const completedPreview = (
      await callMcp(writer, "preview_import", { document: completedChange })
    ).structuredContent;
    assert.equal(completedPreview.approvalRequired, true, JSON.stringify(completedPreview));
    expectMcpError(
      await callMcp(writer, "commit_import", {
        document: completedChange,
        previewToken: completedPreview.previewToken,
      }),
      409,
    );
    assert.equal(
      (await admin.collection("paideuo_programs").getOne(draftProgramId)).name,
      draftArgs.name,
    );

    const entry = { date: "2026-10-14", recovery: { sleepHours: 7 } };
    const checkInConflict = expectMcpError(
      await callMcp(writer, "submit_check_ins", {
        entries: [entry, entry],
      }),
      409,
    );
    assert.equal(checkInConflict.rolledBack, true);
    assert.ok(checkInConflict.rows.every(({ code }) => code === "duplicate_target"));
    const mcpCheckIns = () =>
      admin.collection("paideuo_daily_recovery").getFullList({
        filter: admin.filter("owner = {:owner} && date = {:date}", {
          owner: owner.userId,
          date: entry.date,
        }),
      });
    assert.equal((await mcpCheckIns()).length, 0);
    const checkInArgs = { entries: [entry], operationId: "mcp-check-in-1" };
    const checkInResult = await callMcp(writer, "submit_check_ins", checkInArgs);
    assert.equal(checkInResult.structuredContent.created, 1);
    assert.deepEqual(
      (await callMcp(writer, "submit_check_ins", checkInArgs)).structuredContent,
      checkInResult.structuredContent,
    );
    assert.equal((await mcpCheckIns()).length, 1);

    const workoutArgs = {
      data: { ...replacementDocument.data, notes: "MCP workout result" },
      operationId: "mcp-workout-1",
      replaceExistingCompletion: true,
    };
    const workoutResult = await callMcp(writer, "record_workout", workoutArgs);
    assert.equal(workoutResult.structuredContent.updated, 1, JSON.stringify(workoutResult));
    assert.deepEqual(
      (await callMcp(writer, "record_workout", workoutArgs)).structuredContent,
      workoutResult.structuredContent,
    );
    assert.equal(
      (await admin.collection("paideuo_session_completions").getOne(rewrittenCompletion.id)).notes,
      workoutArgs.data.notes,
    );
  });
});

test("PocketBase upgrades historical component results and rolls back failed completion edits", async () => {
  await withPocketBase(
    async ({ admin, baseUrl, upgrade }) => {
      const { client, userId } = await createAuthedUser(admin, baseUrl, "legacy-results");
      const date = "2026-01-05";
      const createSession = (components, operationId) =>
        admin.collection("paideuo_scheduled_sessions").create({
          owner: userId,
          timezone: "UTC",
          operation_id: operationId,
          scheduled_date: date,
          original_date: date,
          slot_position: 1,
          prescription_snapshot: { title: "Strength", components },
          status: "completed",
        });
      const session = await createSession(
        [{ name: "Squat" }, { name: "Press" }, { name: "Row" }, { name: "Carry", key: "carry" }],
        "legacy-component-session",
      );
      const sessionOnly = await createSession([{ name: "Cooldown" }], "legacy-session-only");
      const completions = admin.collection("paideuo_session_completions");
      const results = admin.collection("paideuo_workout_component_results");
      const completion = await completions.create({
        session: session.id,
        completed_date: date,
        actual_duration_min: 50,
        session_rpe: 7,
        notes: "Legacy completion",
        external_id: "legacy-import",
      });
      await completions.create({
        session: sessionOnly.id,
        completed_date: date,
        notes: "Legacy session without component results",
      });
      const squat = await results.create({
        session: session.id,
        component_key: "imported-squat",
        planned_position: 1,
        name: "Squat",
        completed: true,
        sets_completed: 3,
        reps_completed: "5",
        actual_load: { value: 60, unit: "kg" },
        rpe: 6,
      });
      const press = await results.create({
        session: session.id,
        component_key: "imported-press",
        planned_position: 2,
        name: "Press",
        completed: true,
      });
      const calendar = () => client.send(`/api/paideuo/calendar?start=${date}&end=${date}`);
      const readSession = async () => (await calendar()).find(({ id }) => id === session.id);
      const save = (current, body) =>
        client.send(`/api/paideuo/calendar/sessions/${session.id}/execution`, {
          method: "PATCH",
          body: {
            action: "edit-completion",
            revision: current.revision,
            completion: current.completion,
            ...body,
          },
        });
      const beforeUpgrade = await readSession();
      await upgrade();

      const migrated = await readSession();
      assert.equal(migrated.status, "completed");
      assert.deepEqual(migrated.completion, beforeUpgrade.completion);
      assert.notEqual(migrated.revision, beforeUpgrade.revision);
      const [squatKey, pressKey, rowKey, carryKey] = migrated.prescription.components.map(
        ({ key }) => key,
      );
      assert.equal(squatKey, squat.component_key);
      assert.equal(pressKey, press.component_key);
      assert.match(rowKey, /^snapshot:[a-f0-9]{64}$/);
      assert.equal(carryKey, "carry");
      assert.deepEqual(migrated.componentResults, [
        {
          componentKey: squatKey,
          load: { value: 60, unit: "kg" },
          sets: 3,
          reps: "5",
          rpe: 6,
          durationMin: null,
          rounds: null,
          runningMin: null,
          walkingMin: null,
          continuousBoutMin: null,
          aerobicModality: null,
          notes: "",
          observation: null,
        },
        {
          componentKey: pressKey,
          load: null,
          sets: null,
          reps: null,
          rpe: null,
          durationMin: null,
          rounds: null,
          runningMin: null,
          walkingMin: null,
          continuousBoutMin: null,
          aerobicModality: null,
          notes: "",
          observation: null,
        },
      ]);
      const sessionOnlyState = (await calendar()).find(({ id }) => id === sessionOnly.id);
      assert.equal(sessionOnlyState.status, "completed");
      assert.equal(sessionOnlyState.completion.notes, "Legacy session without component results");
      assert.deepEqual(sessionOnlyState.componentResults, []);
      const editedSquat = { ...migrated.componentResults[0], rpe: 8 };
      const emptyRow = { ...migrated.componentResults[1], componentKey: rowKey };

      await assert.rejects(
        () => save(beforeUpgrade, { componentResults: [editedSquat] }),
        (error) => error.status === 409,
      );
      for (const componentResults of [[editedSquat, editedSquat], [{ componentKey: "unknown" }]]) {
        await assert.rejects(
          () => save(migrated, { componentResults }),
          (error) => error.status === 400,
        );
      }

      await assert.rejects(
        () =>
          save(migrated, {
            completion: { ...migrated.completion, notes: "Should roll back" },
            componentResults: [
              editedSquat,
              emptyRow,
              { componentKey: carryKey, notes: injectedFailureMarker },
            ],
          }),
        (error) =>
          error.status === 400 &&
          /Injected component result write failure/.test(error.response.message),
      );
      assert.deepEqual(await readSession(), migrated);
      assert.equal((await results.getOne(squat.id)).rpe, 6);
      assert.equal((await results.getOne(press.id)).component_key, pressKey);
      assert.equal((await completions.getOne(completion.id)).notes, "Legacy completion");

      const edited = await save(migrated, { componentResults: [emptyRow, editedSquat] });
      assert.deepEqual(edited.componentResults, [editedSquat, emptyRow]);
      assert.equal(edited.completion.sessionRpe, 7);
      assert.equal((await results.getOne(squat.id)).rpe, 8);
      await assert.rejects(
        () => results.getOne(press.id),
        (error) => error.status === 404,
      );
      const refreshed = await readSession();
      assert.equal(refreshed.revision, edited.revision);
      assert.deepEqual(refreshed.componentResults, edited.componentResults);
      await assert.rejects(
        () => save(migrated, { componentResults: migrated.componentResults }),
        (error) => error.status === 409,
      );
      const legacyClient = await save(refreshed, {
        completion: { ...refreshed.completion, notes: "Saved without a component payload" },
      });
      assert.deepEqual(legacyClient.componentResults, edited.componentResults);
      assert.deepEqual((await readSession()).componentResults, edited.componentResults);
    },
    { pendingMigration: "1760000021_component_workout_results.js" },
  );
});

test("imported Winter GPP intervals and saved component results reach weekly metrics", async () => {
  await withPocketBase(async ({ admin, baseUrl }) => {
    const { client, userId } = await createAuthedUser(admin, baseUrl, "aerobic-metrics");
    const document = makeProgramDocument();
    document.data.program.name = "Winter GPP";
    const [block] = document.data.blocks;
    document.data.blocks = [block];
    block.durationWeeks = 3;
    block.slots = [
      { externalId: "tue", weekday: 2, position: 1, label: "Jogging" },
      { externalId: "wed", weekday: 3, position: 2, label: "Cycling and mobility" },
      { externalId: "sat", weekday: 6, position: 3, label: "Endurance and sauna" },
    ];
    const workout = (slotExternalId, components) => ({
      slotExternalId,
      workout: { title: slotExternalId, sessionType: "other", components },
    });
    const component = (key, durationMin, classification = "aerobic") => ({
      key,
      name: key,
      durationMin,
      classification,
    });
    block.weeks = [
      [3, 300],
      [4, 300],
      [2, 600],
    ].map(([repetitions, seconds], index) => {
      const run = {
        ...component("run", null),
        targets: {
          repetitions,
          segments: [
            { type: "warmup", duration_seconds: 120, modality: "walking" },
            { type: "work", duration_seconds: seconds, modality: "running" },
            { type: "recovery", duration_seconds: 60, modality: "walking" },
          ],
        },
      };
      return {
        externalId: `week-${index + 1}`,
        position: index + 1,
        weekType: "normal",
        prescriptions: [
          workout("tue", [run]),
          ...(index === 0
            ? [
                workout("wed", [component("cycle", 30), component("mobility", 10, "mobility")]),
                workout("sat", [
                  component("endurance", 40),
                  component("sauna", 15, "other"),
                  { key: "legacy", name: "Legacy", durationMin: 10 },
                ]),
              ]
            : []),
        ],
      };
    });
    const preview = await previewImport(client, document);
    await commitImport(client, document, preview.previewToken);
    const repeatedPreview = await previewImport(client, document);
    assert.deepEqual(
      repeatedPreview.items.filter(({ status }) => status !== "skip"),
      [],
    );
    const program = await admin
      .collection("paideuo_programs")
      .getFirstListItem(admin.filter("owner = {:owner}", { owner: userId }));
    const path = `/api/paideuo/programs/${program.id}/schedule`;
    const schedule = { startDate: "2026-01-05", timezone: "UTC" };
    const { revision } = await client.send(path + "/preview", { method: "POST", body: schedule });
    await client.send(path, { method: "POST", body: { ...schedule, revision } });

    const weekly = async (start) =>
      (await client.send(`/api/paideuo/metrics?view=weekly&program=${program.id}&start=${start}`))
        .total.compliance;
    const [first, second, third] = await Promise.all(
      ["2026-01-06", "2026-01-13", "2026-01-20"].map(weekly),
    );
    assert.deepEqual(
      [first, second, third].map((week) => week.plannedRunningMinutes),
      [15, 20, 20],
    );
    assert.deepEqual(
      [first, second, third].map((week) => week.plannedContinuousBoutMinutes),
      [5, 5, 10],
    );
    assert.deepEqual(
      [first, second, third].map((week) => week.plannedWalkingMinutes),
      [5, 6, 4],
    );
    assert.deepEqual(
      [first, second, third].map((week) => week.plannedAerobicMinutes),
      [90, 26, 24],
    );

    const sessions = await client.send("/api/paideuo/calendar?start=2026-01-05&end=2026-01-11");
    const [tuesday, wednesday, saturday] = sessions;
    const complete = (session, componentResults) =>
      client.send(`/api/paideuo/calendar/sessions/${session.id}/execution`, {
        method: "PATCH",
        body: {
          action: "complete",
          revision: session.revision,
          completion: { completedDate: session.scheduledDate, actualDurationMin: 50 },
          componentResults,
        },
      });
    await assert.rejects(
      () =>
        complete(tuesday, [
          { componentKey: "run", durationMin: 15, runningMin: 20, walkingMin: 5 },
        ]),
      (error) => error.status === 400 && /elapsed component duration/.test(error.response.message),
    );
    await assert.rejects(
      () => complete(tuesday, [{ componentKey: "run", runningMin: 12, continuousBoutMin: 13 }]),
      (error) => error.status === 400 && /longest continuous bout/.test(error.response.message),
    );
    await complete(tuesday, []);
    const missing = await weekly("2026-01-06");
    assert.equal(missing.aerobicMinutes, null);
    assert.deepEqual(missing.aerobicCoverage, { measured: 0, specified: 1 });

    await complete(wednesday, [
      { componentKey: "cycle", durationMin: 25, aerobicModality: "Cycling", continuousBoutMin: 20 },
      { componentKey: "mobility", durationMin: 10 },
    ]);
    await complete(saturday, [
      {
        componentKey: "endurance",
        runningMin: 30,
        walkingMin: 4,
        continuousBoutMin: 12,
        aerobicModality: "Run/walk",
      },
      { componentKey: "sauna", durationMin: 15 },
      { componentKey: "legacy", durationMin: 10 },
    ]);
    const measured = await weekly("2026-01-06");
    assert.equal(measured.actualMinutes, 150);
    assert.equal(measured.aerobicMinutes, 59);
    assert.equal(measured.actualRunningMinutes, 30);
    assert.equal(measured.actualWalkingMinutes, 4);
    assert.equal(measured.actualContinuousBoutMinutes, 20);
    assert.deepEqual(measured.aerobicByModality, { cycling: 25, "run/walk": 34 });
    assert.deepEqual(measured.aerobicCoverage, { measured: 2, specified: 3 });
  });
});

test("invalid prescription segment text cannot become a save payload", async () => {
  const { componentPayload, segmentError } =
    await import("../../src/features/prescriptions/components.ts");
  const draft = { key: 0, name: "Intervals", instructions: "" };
  for (const value of ["[", "[]", '[{"type":"work","duration_seconds":-1}]']) {
    assert.match(segmentError(value), /nonempty JSON array/);
    assert.throws(
      () => componentPayload({ ...draft, targets: { segments: [value] } }),
      /nonempty JSON array/,
    );
  }
  const segments = [{ type: "work", duration_seconds: 60, modality: "running" }];
  const value = JSON.stringify(segments);
  assert.equal(segmentError(value), "");
  assert.deepEqual(
    componentPayload({ ...draft, targets: { segments: [value] } }).targets.segments,
    segments,
  );
});

test("archived programs can be unscheduled after a schedule revision", async () => {
  await withPocketBase(async ({ admin, baseUrl }) => {
    const { client } = await createAuthedUser(admin, baseUrl, "archived-unschedule");
    const document = makeProgramDocument();
    const preview = await previewImport(client, document);
    const { rows } = await commitImport(client, document, preview.previewToken);
    const root = `/api/paideuo/programs/${rows.programId}`;
    const post = (action, body) => client.send(root + action, { method: "POST", body });
    const start = { startDate: "2026-01-05", timezone: "UTC" };
    const { revision } = await post("/schedule/preview", start);
    const schedule = await post("/schedule", { ...start, revision });
    const receipt = await admin.collection("paideuo_schedule_revision_receipts").create({
      schedule: schedule.id,
      operation_id: "2f946a91-409c-4646-b62f-010c5adbcd04",
      request_hash: "a".repeat(64),
      applied: 1,
    });
    const sessions = admin.collection("paideuo_scheduled_sessions");
    const filter = admin.filter("schedule = {:id}", { id: schedule.id });

    await post("/archive", { unscheduleWorkouts: false });
    assert.equal((await client.send(root)).scheduled, true);
    assert.ok((await sessions.getFullList({ filter })).length > 0);

    await post("/unschedule");
    const program = await client.send(root);
    assert.equal(program.status, "archived");
    assert.equal(program.scheduled, false);
    assert.deepEqual(await sessions.getFullList({ filter }), []);
    await assert.rejects(
      admin.collection("paideuo_schedule_revision_receipts").getOne(receipt.id),
      { status: 404 },
    );
  });
});

test("prescription ranges survive import, editing, templates, block duplication and scheduling", async () => {
  await withPocketBase(async ({ admin, baseUrl }) => {
    const { client } = await createAuthedUser(admin, baseUrl, "prescription-ranges");
    const request = (path, method = "GET", body) => client.send(path, { method, body });
    const document = makeProgramDocument();
    const [rangeBlock, scalarBlock] = document.data.blocks;
    const ranges = {
      plannedDurationMin: 35,
      plannedDurationMax: 40,
      plannedRpeMin: 6,
      plannedRpeMax: 7,
    };
    const components = [
      {
        key: "cycle",
        name: "Cycle",
        instructions: "Steady",
        classification: "aerobic",
        durationMin: 35,
        durationMax: 40,
        targets: { intensity: { min: 6, max: 7, scale: "RPE" } },
      },
      { key: "zero", name: "Zero", instructions: "", durationMin: 0, durationMax: 0 },
    ];
    Object.assign(rangeBlock.weeks[0].prescriptions[0].workout, ranges, { components });
    scalarBlock.weeks[0].prescriptions[0].workout.plannedDurationMin = 35;

    const preview = await previewImport(client, document);
    const imported = await commitImport(client, document, preview.previewToken);
    const root = `/api/paideuo/programs/${imported.rows.programId}`;
    const location = async (blockId, slotId) => {
      const [week] = await admin.collection("paideuo_program_weeks").getFullList({
        filter: admin.filter("block = {:block}", { block: blockId }),
        sort: "position",
      });
      const slot = slotId
        ? null
        : await admin
            .collection("paideuo_session_slots")
            .getFirstListItem(admin.filter("block = {:block}", { block: blockId }));
      return `${root}/blocks/${blockId}/weeks/${week.id}/cells/${slotId ?? slot.id}`;
    };
    const findBlock = (externalId) =>
      admin.collection("paideuo_blocks").getFirstListItem(
        admin.filter("program = {:program} && external_id = {:externalId}", {
          program: imported.rows.programId,
          externalId,
        }),
      );
    const [block, scalar] = await Promise.all([
      findBlock(rangeBlock.externalId),
      findBlock(scalarBlock.externalId),
    ]);
    const cellPath = await location(block.id);
    const assertRanges = (prescription, expected = ranges) => {
      for (const [key, value] of Object.entries(expected)) assert.equal(prescription[key], value);
      const [cycle, zero] = prescription.components;
      assert.deepEqual(
        Object.fromEntries(Object.keys(components[0]).map((key) => [key, cycle[key]])),
        components[0],
      );
      assert.equal(zero.durationMin, 0);
      assert.equal(zero.durationMax, 0);
    };
    const first = await request(cellPath);
    assertRanges(first.prescription);
    const repeated = await previewImport(client, document);
    assert.deepEqual(
      repeated.items.filter(({ status }) => status !== "skip"),
      [],
    );
    assert.equal(
      (await commitImport(client, document, repeated.previewToken)).rows.unchanged,
      true,
    );

    const patch = (path, cell, changes) =>
      request(path, "PATCH", { ...cell.prescription, revision: cell.revision, ...changes });
    const scalarPath = await location(scalar.id);
    const scalarCell = await request(scalarPath);
    assert.equal(scalarCell.prescription.plannedDurationMin, 35);
    assert.equal(scalarCell.prescription.plannedDurationMax, null);
    await patch(scalarPath, scalarCell, { title: "Edited scalar" });
    const editedScalar = (await request(scalarPath)).prescription;
    assert.equal(editedScalar.title, "Edited scalar");
    assert.equal(editedScalar.plannedDurationMin, 35);
    assert.equal(editedScalar.plannedDurationMax, null);
    assert.equal(editedScalar.plannedRpeMin, null);
    assert.equal(editedScalar.components[0].durationMax, null);

    const cycle = first.prescription.components[0];
    for (const changes of [
      { plannedDurationMax: 34 },
      { plannedRpeMax: 5 },
      { components: [{ ...cycle, durationMax: 34 }] },
      { components: [{ ...cycle, targets: { intensity: { min: 7, max: 6, scale: "RPE" } } }] },
    ]) {
      await assert.rejects(
        () => patch(cellPath, first, changes),
        (error) => error.status === 400,
      );
    }
    assert.deepEqual(await request(cellPath), first);
    await patch(cellPath, first, { plannedDurationMin: 0, plannedDurationMax: 0 });
    const zeroSession = await request(cellPath);
    assertRanges(zeroSession.prescription, {
      ...ranges,
      plannedDurationMin: 0,
      plannedDurationMax: 0,
    });
    // Clearing a stored zero changes presence even though PocketBase's numeric value stays zero.
    await patch(cellPath, zeroSession, {
      ...ranges,
      components: [cycle, { ...components[1], durationMax: null }],
    });
    const cleared = await request(cellPath);
    assert.equal(cleared.prescription.components[1].durationMax, null);
    await patch(cellPath, cleared, { components });
    const edited = await request(cellPath);
    assertRanges(edited.prescription);

    const { id: duplicateId } = await request(`${root}/blocks/${block.id}/duplicate`, "POST", {
      destinationProgramId: imported.rows.programId,
    });
    assertRanges((await request(await location(duplicateId))).prescription);

    const templates = "/api/paideuo/templates";
    const readTemplate = async (id) =>
      (await request(templates)).find((template) => template.id === id);
    const { id: savedTemplate } = await request(cellPath + "/template", "POST", {
      name: "Range template",
      revision: edited.revision,
    });
    const fromCell = await readTemplate(savedTemplate);
    assertRanges(fromCell);
    const { id: templateId } = await request(templates, "POST", {
      ...fromCell,
      name: "Range baseline",
    });
    const template = await readTemplate(templateId);
    assertRanges(template);
    const slots = `${root}/blocks/${block.id}/slots`;
    const { id: baselineSlot } = await request(slots, "POST", { weekday: 2, label: "Baseline" });
    await request(`${slots}/${baselineSlot}/baseline`, "PATCH", { templateId });
    assert.equal((await request(`${root}/blocks/${block.id}/initialize-weeks`, "POST")).created, 1);
    assertRanges((await request(await location(block.id, baselineSlot))).prescription);

    const { id: insertedSlot } = await request(slots, "POST", { weekday: 3, label: "Inserted" });
    const insertedPath = await location(block.id, insertedSlot);
    // Submit the same fields the week editor uses when inserting a template.
    await patch(insertedPath, await request(insertedPath), {
      ...template,
      title: template.name,
      notes: "",
    });
    assertRanges((await request(insertedPath)).prescription);

    const schedule = { startDate: "2026-01-05", timezone: "UTC" };
    const { revision } = await request(root + "/schedule/preview", "POST", schedule);
    await request(root + "/schedule", "POST", { ...schedule, revision });
    const calendar = () => request("/api/paideuo/calendar?start=2026-01-05&end=2026-01-07");
    const before = await calendar();
    assert.equal(before.length, 3);
    for (const session of before) assertRanges(session.prescription);
    await patch(cellPath, await request(cellPath), { plannedDurationMax: 45, plannedRpeMax: 8 });
    assert.deepEqual(await calendar(), before);

    const { id: oneOffId } = await request("/api/paideuo/calendar/sessions", "POST", {
      scheduledDate: "2026-01-07",
      timezone: "UTC",
      operationId: crypto.randomUUID(),
      prescription: { ...edited.prescription, plannedDurationMin: 0, plannedDurationMax: 0 },
    });
    const oneOff = (await calendar()).find(({ id }) => id === oneOffId);
    assertRanges(oneOff.prescription, { ...ranges, plannedDurationMin: 0, plannedDurationMax: 0 });
  });
});

test("component RPE requires a minimum when a maximum is provided", async () => {
  const { componentPayload, targetRangeError } =
    await import("../../src/features/prescriptions/components.ts");
  const draft = { key: 0, name: "Cycle", instructions: "" };
  const payload = (intensity) => componentPayload({ ...draft, targets: { intensity } });
  assert.match(targetRangeError("intensity", ["", "7"]), /Enter a minimum RPE/);
  assert.throws(() => payload(["", "7"]), /Enter a minimum RPE/);
  assert.deepEqual(payload(["6", ""]).targets.intensity, { value: 6, scale: "RPE" });
  assert.deepEqual(payload(["6", "7"]).targets.intensity, { min: 6, max: 7, scale: "RPE" });
});

test("duration presence migration preserves existing positive maxima and scalar prescriptions", async () => {
  await withPocketBase(
    async ({ admin, baseUrl, upgrade }) => {
      const { client, userId } = await createAuthedUser(admin, baseUrl, "range-upgrade");
      const program = await admin.collection("paideuo_programs").create({
        owner: userId,
        name: "Existing program",
        status: "draft",
      });
      const block = await admin.collection("paideuo_blocks").create({
        program: program.id,
        name: "Existing block",
        position: 1,
        duration_weeks: 1,
      });
      const week = await admin.collection("paideuo_program_weeks").create({
        block: block.id,
        position: 1,
        week_type: "normal",
      });
      const createPrescription = async (day, max) => {
        const slot = await admin.collection("paideuo_session_slots").create({
          block: block.id,
          weekday: day,
          position: 1,
          label: "Cycle",
        });
        const session = await admin.collection("paideuo_session_prescriptions").create({
          slot: slot.id,
          program_week: week.id,
          title: "Cycle",
          session_type: "conditioning",
          planned_duration_min: 35,
          duration_specified: true,
          planned_duration_max: max,
        });
        await admin.collection("paideuo_training_components").create({
          prescription: session.id,
          name: "Cycle",
          position: 1,
          duration_min: 35,
          duration_specified: true,
          duration_max: max,
        });
        return `/api/paideuo/programs/${program.id}/blocks/${block.id}/weeks/${week.id}/cells/${slot.id}`;
      };
      const rangedPath = await createPrescription(1, 40);
      const scalarPath = await createPrescription(2);
      await upgrade();

      for (const [url, max] of [
        [rangedPath, 40],
        [scalarPath, null],
      ]) {
        const { prescription } = await client.send(url);
        assert.equal(prescription.plannedDurationMin, 35);
        assert.equal(prescription.plannedDurationMax, max);
        assert.equal(prescription.components[0].durationMin, 35);
        assert.equal(prescription.components[0].durationMax, max);
      }
    },
    { pendingMigration: "1760000024_prescription_max_duration_presence.js" },
  );
});

test("weekly review compares persisted aerobic plans and results and links exact source sessions", async () => {
  await withPocketBase(async ({ admin, baseUrl }) => {
    const { client } = await createAuthedUser(admin, baseUrl, "weekly-progression");
    const request = (path, method = "GET", body) => client.send(path, { method, body });
    const document = makeProgramDocument();
    const [block] = document.data.blocks;
    document.data.blocks = [block];
    block.durationWeeks = 3;
    block.slots = [
      { externalId: "intervals", weekday: 2, position: 1, label: "Intervals" },
      { externalId: "cycling", weekday: 2, position: 2, label: "Cycling" },
      { externalId: "endurance", weekday: 3, position: 3, label: "Endurance" },
      { externalId: "rowing", weekday: 4, position: 4, label: "Rowing" },
    ];
    const component = (key, name, fields = {}) => ({
      key,
      name,
      classification: "aerobic",
      ...fields,
    });
    const intervals = {
      repetitions: 4,
      segments: [
        { type: "warmup", duration_seconds: 300, modality: "walking" },
        { type: "work", duration_seconds: 180, modality: "running" },
        { type: "recovery", duration_seconds: 120, modality: "walking" },
        { type: "cooldown", duration_seconds: 300, modality: "walking" },
      ],
    };
    const prescribedRpe = { min: 6, max: 7, scale: "RPE" };
    const workout = (slotExternalId, title, components) => ({
      slotExternalId,
      workout: { title, sessionType: "conditioning", plannedDurationMin: 60, components },
    });
    const cycling = workout("cycling", "Bike training", [
      component("cycle", "Steady cycling", { durationMin: 35, durationMax: 40 }),
    ]);
    block.weeks = [
      [
        workout("intervals", "Interval training", [
          component("jog", "Jog/walk intervals", { targets: intervals }),
          component("squat", "Front squat", {
            classification: "strength",
            targets: {
              sets: 3,
              reps: "5",
              load: { value: 80, unit: "kg" },
              intensity: prescribedRpe,
            },
          }),
          component("circuit", "Strength circuit", {
            classification: "other",
            targets: { repetitions: 4 },
          }),
        ]),
        cycling,
        workout("endurance", "Endurance work", [component("walk", "Walking", { durationMin: 25 })]),
        workout("rowing", "Row training", [component("row", "Rowing", { durationMin: 20 })]),
      ],
      [],
      [cycling],
    ].map((prescriptions, index) => ({
      externalId: `review-week-${index + 1}`,
      position: index + 1,
      weekType: "normal",
      prescriptions,
    }));
    const preview = await previewImport(client, document);
    const {
      rows: { programId },
    } = await commitImport(client, document, preview.previewToken);
    const root = `/api/paideuo/programs/${programId}`;

    const monday = new Date();
    monday.setUTCHours(0, 0, 0, 0);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 7);
    const date = (offset) =>
      new Date(monday.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    const schedule = { startDate: date(0), timezone: "UTC" };
    const { revision } = await request(root + "/schedule/preview", "POST", schedule);
    await request(root + "/schedule", "POST", { ...schedule, revision });
    const calendarPath = `/api/paideuo/calendar?start=${date(0)}&end=${date(6)}`;
    const calendar = await request(calendarPath);
    const [jog, cycle, missing, skipped] = calendar;
    assert.equal(jog.scheduledDate, cycle.scheduledDate);
    const complete = (session, componentResults) =>
      request(`/api/paideuo/calendar/sessions/${session.id}/execution`, "PATCH", {
        action: "complete",
        revision: session.revision,
        completion: { completedDate: session.scheduledDate, actualDurationMin: 50 },
        componentResults,
      });
    await complete(jog, [
      {
        componentKey: "jog",
        runningMin: 10,
        walkingMin: 17,
        continuousBoutMin: 4,
        aerobicModality: "Run/walk",
      },
      { componentKey: "squat", sets: 3, reps: "5", load: { value: 75, unit: "kg" }, rpe: 7 },
      { componentKey: "circuit", rounds: 3 },
    ]);
    await complete(cycle, [{ componentKey: "cycle", durationMin: 36, aerobicModality: "BIKE" }]);
    await complete(missing, []);
    await domainRequest(client, "check-ins/upsert", {
      entries: [{ date: date(1), recovery: { sleepHours: 8 } }],
    });

    const scheduled = await admin.collection("paideuo_scheduled_sessions").getOne(jog.id);
    const weekId = scheduled.source_attribution.weekId;
    const reviewPath = `${root}/weekly-reviews`;
    const review = await request(`${reviewPath}/${weekId}`);
    const source = (session, status) => ({
      id: session.id,
      date: session.scheduledDate,
      title: session.prescription.title,
      status,
    });
    const outcome = {
      sessionId: jog.id,
      date: jog.scheduledDate,
      status: "completed",
    };
    assert.equal(review.programName, document.data.program.name);
    assert.equal(review.weekId, weekId);
    assert.deepEqual(review.dataCoverage, {
      scheduledSessions: 4,
      completedSessions: 3,
      recoveryDays: 1,
    });
    assert.equal(review.total.recovery.sleepHours.mean, 8);
    assert.equal(review.total.compliance.plannedMinutes, 240);
    assert.equal(review.total.compliance.actualMinutes, 150);
    assert.deepEqual(review.progression, {
      jogging: [{ ...outcome, title: "Jog/walk intervals", plannedBoutMin: 3, actualBoutMin: 4 }],
      frontSquat: [
        {
          ...outcome,
          title: "Front squat",
          plannedLoad: { value: 80, unit: "kg" },
          plannedSets: 3,
          plannedReps: "5",
          plannedRpe: prescribedRpe,
          actualLoad: { value: 75, unit: "kg" },
          actualSets: 3,
          actualReps: "5",
          actualRpe: 7,
        },
      ],
      circuits: [{ ...outcome, title: "Strength circuit", plannedRounds: 4, actualRounds: 3 }],
      aerobicByModality: { running: 10, walking: 17, cycling: 36 },
      plannedAerobicByModality: { running: 12, walking: 43, cycling: 35, rowing: 20 },
      plannedAerobicMaxByModality: { running: 12, walking: 43, cycling: 40, rowing: 20 },
      aerobicCoverage: { planned: 4, measured: 2, specified: 3 },
      sourceSessions: [
        source(jog, "completed"),
        source(cycle, "completed"),
        source(missing, "completed"),
        source(skipped, "skipped"),
      ],
    });
    const metrics = (
      await request(`/api/paideuo/metrics?view=weekly&program=${programId}&start=${date(1)}`)
    ).total.compliance;
    assert.equal(metrics.plannedAerobicMinutes, 110);
    assert.equal(metrics.aerobicMinutes, 63);
    assert.equal(
      Object.values(review.progression.plannedAerobicByModality).reduce(
        (sum, value) => sum + value,
        0,
      ),
      metrics.plannedAerobicMinutes,
    );
    assert.deepEqual(review.total.compliance, metrics);

    const { sessionCalendarUrl, selectedCalendarSession } =
      await import("../../src/features/calendar/session-links.ts");
    for (const session of review.progression.sourceSessions.slice(0, 2)) {
      const url = new URL(sessionCalendarUrl(session.date, session.id), baseUrl);
      assert.equal(url.searchParams.get("date"), jog.scheduledDate);
      assert.equal(selectedCalendarSession(calendar, url.searchParams).id, session.id);
    }
    const { formatPlannedRpe } = await import("../../src/features/prescriptions/format.ts");
    const { min, max } = review.progression.frontSquat[0].plannedRpe;
    assert.equal(formatPlannedRpe(min, max), "6–7 RPE");

    const weekRows = await admin.collection("paideuo_program_weeks").getFullList({
      filter: admin.filter("block.program = {:programId}", { programId }),
      sort: "position",
    });
    const future = await request(`${reviewPath}/${weekRows[2].id}`);
    assert.deepEqual(future.progression.aerobicCoverage, { planned: 1, measured: 0, specified: 0 });
    assert.deepEqual(future.progression.aerobicByModality, {});
    assert.equal(future.progression.sourceSessions[0].status, "planned");

    const original = await admin
      .collection("paideuo_session_prescriptions")
      .getOne(scheduled.source_prescription_id);
    const cellPath = `${root}/blocks/${weekRows[0].block}/weeks/${weekId}/cells/${original.slot}`;
    const cell = await request(cellPath);
    await request(cellPath, "PATCH", {
      ...cell.prescription,
      title: "Changed plan",
      components: [],
      revision: cell.revision,
    });
    assert.deepEqual(await request(`${reviewPath}/${weekId}`), review);
  });
});

test("movement observations survive completion edits, import reconciliation and weekly review", async () => {
  await withPocketBase(async ({ admin, baseUrl }) => {
    const { client } = await createAuthedUser(admin, baseUrl, "movement-observations");
    const request = (path, method = "GET", body) => client.send(path, { method, body });
    const document = makeProgramDocument();
    const [block] = document.data.blocks;
    document.data.blocks = [block];
    block.slots = [
      { externalId: "manual", weekday: 1, position: 1, label: "Manual result" },
      { externalId: "imported", weekday: 1, position: 2, label: "Imported result" },
    ];
    block.weeks[0].prescriptions = block.slots.map((slot) => ({
      slotExternalId: slot.externalId,
      workout: {
        title: slot.label,
        sessionType: "strength",
        components: [{ key: "front-squat", name: "Front squat", classification: "strength" }],
      },
    }));
    const plan = await previewImport(client, document);
    const {
      rows: { programId },
    } = await commitImport(client, document, plan.previewToken);
    const date = "2026-01-05";
    const root = `/api/paideuo/programs/${programId}`;
    const schedule = { startDate: date, timezone: "UTC" };
    const { revision } = await request(root + "/schedule/preview", "POST", schedule);
    await request(root + "/schedule", "POST", { ...schedule, revision });
    const calendar = () => request(`/api/paideuo/calendar?start=${date}&end=${date}`);
    const sessions = await calendar();
    const manual = sessions.find(({ prescription }) => prescription.title === "Manual result");
    const imported = sessions.find(({ prescription }) => prescription.title === "Imported result");
    const source = await admin.collection("paideuo_scheduled_sessions").getOne(manual.id);
    const review = async () =>
      (await request(`${root}/weekly-reviews/${source.source_attribution.weekId}`))
        .movementObservations;
    const completion = { completedDate: date, actualDurationMin: 30, sessionRpe: 6, notes: "" };
    const execution = (state, action, result) =>
      request(`/api/paideuo/calendar/sessions/${manual.id}/execution`, "PATCH", {
        action,
        revision: state.revision,
        completion,
        componentResults: [result],
      });
    const result = { componentKey: "front-squat", sets: 3, notes: "Original component notes" };
    const observation = {
      category: "knee_tracking",
      severity: "not_assessed",
      context: "",
      notes: "",
    };
    for (const invalid of [
      { ...observation, category: " " },
      { ...observation, severity: "invalid" },
    ]) {
      await assert.rejects(
        () => execution(manual, "complete", { ...result, observation: invalid }),
        (error) => error.status === 400,
      );
    }
    assert.deepEqual(await calendar(), sessions);
    const initial = await execution(manual, "complete", result);
    assert.equal(initial.componentResults[0].observation, null);
    assert.deepEqual(await review(), []);

    const recorded = await execution(initial, "edit-completion", {
      ...initial.componentResults[0],
      observation,
    });
    const identify = (session, value) => ({
      sessionId: session.id,
      sessionDate: date,
      componentKey: "front-squat",
      componentName: "Front squat",
      ...value,
    });
    assert.deepEqual(await review(), [identify(manual, observation)]);
    const assessed = { ...observation, severity: "none", context: "Working sets" };
    const assessedState = await execution(recorded, "edit-completion", {
      ...recorded.componentResults[0],
      observation: assessed,
    });
    assert.deepEqual((await review())[0].severity, "none");
    const edited = await execution(assessedState, "edit-completion", {
      ...assessedState.componentResults[0],
      notes: "Updated component notes",
    });
    assert.deepEqual(edited.componentResults[0].observation, assessed);

    const importedObservation = {
      category: "trunk_position",
      severity: "mild",
      notes: "Final set",
    };
    const workoutDocument = {
      schema: "paideuo",
      version: 1,
      kind: "workout-component-results",
      data: {
        ...completion,
        sourceSessionId: imported.id,
        sourceWorkoutKey: "movement-import",
        components: [
          {
            key: "front-squat",
            plannedPosition: 1,
            name: "Front squat",
            completed: true,
            setsCompleted: 3,
            notes: "Imported component notes",
            observation: importedObservation,
          },
        ],
      },
    };
    const importPreview = await previewImport(client, workoutDocument);
    await commitImport(client, workoutDocument, importPreview.previewToken);
    const retry = await previewImport(client, workoutDocument);
    assert.equal(retry.items[0].status, "skip");
    const repeated = await commitImport(client, workoutDocument, retry.previewToken);
    assert.deepEqual(repeated.rows, [{ key: "movement-import", status: "skipped" }]);

    const getObserved = async () =>
      new Map((await review()).map((entry) => [entry.sessionId, entry]));
    const observed = await getObserved();
    assert.deepEqual(observed.get(manual.id), identify(manual, assessed));
    assert.deepEqual(
      observed.get(imported.id),
      identify(imported, { ...importedObservation, context: "" }),
    );
    const { sessionCalendarUrl, selectedCalendarSession } =
      await import("../../src/features/calendar/session-links.ts");
    const refreshed = await calendar();
    for (const entry of observed.values()) {
      const { searchParams } = new URL(
        sessionCalendarUrl(entry.sessionDate, entry.sessionId),
        baseUrl,
      );
      assert.equal(selectedCalendarSession(refreshed, searchParams).id, entry.sessionId);
    }

    const cleared = await execution(edited, "edit-completion", {
      ...edited.componentResults[0],
      observation: null,
    });
    assert.deepEqual(cleared.componentResults[0], {
      ...edited.componentResults[0],
      observation: null,
    });
    assert.equal((await getObserved()).has(manual.id), false);

    const credential = await request("/api/paideuo/v1/service-credentials/issue", "POST", {
      label: "observation-replacement",
      scopes: ["imports:commit", "workouts:write"],
      allowHistoryRewrite: true,
    });
    const { plaintextToken } = credential;
    const replacement = structuredClone(workoutDocument);
    replacement.data.replaceExistingCompletion = true;
    const updatedObservation = {
      ...importedObservation,
      severity: "pronounced",
      context: "Last rep",
    };
    replacement.data.components[0].observation = updatedObservation;
    assert.equal((await previewImport(client, replacement)).items[0].status, "conflict");
    const replace = async (payload) => {
      const preview = await servicePreviewImport(baseUrl, plaintextToken, payload);
      assert.equal(preview.items[0].status, "update");
      return serviceCommitImport(baseUrl, plaintextToken, payload, preview.previewToken);
    };
    await replace(replacement);
    assert.deepEqual(
      (await getObserved()).get(imported.id),
      identify(imported, updatedObservation),
    );

    delete replacement.data.components[0].observation;
    await replace(replacement);
    assert.deepEqual(await review(), []);
    delete replacement.data.replaceExistingCompletion;
    const noObservationRetry = await previewImport(client, replacement);
    assert.equal(noObservationRetry.items[0].status, "skip");
    const after = (await calendar()).find(({ id }) => id === imported.id).componentResults[0];
    assert.equal(after.observation, null);
    assert.equal(after.sets, 3);
    assert.equal(after.notes, "Imported component notes");
  });
});

test("rest and optional recovery survive editing, scheduling, and reporting", async () => {
  await withPocketBase(
    async ({ admin, baseUrl, upgrade }) => {
      const { client } = await createAuthedUser(admin, baseUrl, "rest-recovery");
      const request = (path, method = "GET", body) => client.send(path, { method, body });
      const document = makeProgramDocument();
      const [block] = document.data.blocks;
      document.data.blocks = [block];
      block.slots.push(
        { externalId: "friday-rest", weekday: 5, position: 2, label: "Friday" },
        { externalId: "sunday-rest", weekday: 7, position: 3, label: "Sunday" },
      );
      const { previewToken } = await previewImport(client, document);
      const {
        rows: { programId },
      } = await commitImport(client, document, previewToken);
      const root = `/api/paideuo/programs/${programId}`;
      const [week] = await admin.collection("paideuo_program_weeks").getFullList({
        filter: admin.filter("block.program = {:programId}", { programId }),
      });
      const slots = await admin.collection("paideuo_session_slots").getFullList({
        filter: admin.filter("block = {:block}", { block: week.block }),
        sort: "weekday",
      });
      const cellPath = (slot) => `${root}/blocks/${week.block}/weeks/${week.id}/cells/${slot.id}`;
      const [monday, friday] = slots;
      await upgrade();
      const legacy = (await request(cellPath(monday))).prescription;
      assert.equal(legacy.components[0].name, "Warm-up");
      assert.equal(legacy.components[0].optional, false);
      block.weeks[0].prescriptions.push({
        slotExternalId: "sunday-rest",
        workout: { title: "Sunday rest", sessionType: "rest", components: [] },
      });
      const restImport = await previewImport(client, document);
      await commitImport(client, document, restImport.previewToken);

      const templatePath = "/api/paideuo/templates";
      const { id: templateId } = await request(templatePath, "POST", {
        name: "Rest",
        description: "",
        sessionType: "rest",
        components: [],
      });
      const template = (await request(templatePath)).find(({ id }) => id === templateId);
      const patch = async (slot, prescription) => {
        const path = cellPath(slot);
        const { revision } = await request(path);
        await request(path, "PATCH", { ...prescription, revision });
        return (await request(path)).prescription;
      };
      const rest = await patch(friday, { ...template, title: "Friday rest", notes: "" });
      assert.equal(rest.sessionType, "rest");
      const edited = await patch(monday, {
        ...(await request(cellPath(monday))).prescription,
        plannedDurationMin: 85,
        components: [
          {
            key: "sauna",
            name: "Sauna",
            classification: "aerobic",
            durationMin: 15,
            optional: true,
          },
          {
            key: "stretch",
            name: "Stretch",
            classification: "mobility",
            durationMin: 10,
            optional: true,
          },
        ],
      });
      assert.deepEqual(
        edited.components.map(({ optional }) => optional),
        [true, true],
      );

      const date = "2026-01-05";
      const schedule = { startDate: date, timezone: "UTC" };
      const { revision } = await request(root + "/schedule/preview", "POST", schedule);
      await request(root + "/schedule", "POST", { ...schedule, revision });
      const calendar = () => request(`/api/paideuo/calendar?start=${date}&end=2026-01-11`);
      const [workout, ...restDays] = await calendar();
      assert.deepEqual(
        restDays.map(({ scheduledDate, status, completion }) => [
          scheduledDate,
          status,
          completion,
        ]),
        [
          ["2026-01-09", "rest", null],
          ["2026-01-11", "rest", null],
        ],
      );
      assert.deepEqual(
        workout.prescription.components.map(({ optional }) => optional),
        [true, true],
      );

      await domainRequest(client, "check-ins/upsert", {
        entries: [{ date: restDays[0].scheduledDate, recovery: { sleepHours: 8 } }],
      });
      const executionPath = `/api/paideuo/calendar/sessions/${workout.id}/execution`;
      const completion = { completedDate: date, actualDurationMin: 60, sessionRpe: 7 };
      const complete = (state, action, componentResults) =>
        request(executionPath, "PATCH", {
          action,
          revision: state.revision,
          completion,
          componentResults,
        });
      const checkReports = async () => {
        assert.equal((await calendar())[0].sessionLoad, 420);
        const metrics = (
          await request(`/api/paideuo/metrics?view=weekly&program=${programId}&start=${date}`)
        ).total;
        const { weeks } = await request(root + "/training-load");
        assert.equal(weeks[0].totals.all.load, 420);
        assert.equal(weeks[0].totals.all.scheduledSessions, 1);
        const review = await request(`${root}/weekly-reviews/${week.id}`);
        assert.equal(metrics.load, 420);
        assert.equal(review.total.load, 420);
        assert.equal(review.dataCoverage.scheduledSessions, 1);
        assert.deepEqual(review.total.compliance, metrics.compliance);
        assert.equal(metrics.compliance.scheduled, 1);
        assert.equal(metrics.compliance.adherence, 1);
        assert.equal(metrics.compliance.plannedMinutes, 60);
        assert.equal(metrics.compliance.actualMinutes, 60);
        assert.equal(metrics.compliance.aerobicMinutes, null);
        assert.equal(review.total.recovery.sleepHours.mean, 8);
        assert.deepEqual(review.progression.aerobicByModality, {});
      };
      const completed = await complete(workout, "complete", []);
      await checkReports();
      const logged = await complete(completed, "edit-completion", [
        { componentKey: "sauna", durationMin: 12 },
      ]);
      assert.equal(logged.componentResults[0].durationMin, 12);
      await checkReports();
    },
    { pendingMigration: "1760000026_rest_and_optional_components.js" },
  );
});

test("ChatGPT OAuth discovers MCP, authorizes a Paideuo user, and rotates credentials", async () => {
  const origin = "https://paideuo.example.com";
  const mcpPath = "/api/paideuo/v1/mcp";
  const oauthPath = "/api/paideuo/v1/mcp-oauth";
  const resource = origin + mcpPath;
  const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
  const clientId = "chatgpt";
  const secret = "test-secret-0123456789-0123456789-0123456789";
  const verifier = "test-verifier-0123456789-0123456789-0123456789";
  const basic = "Basic " + Buffer.from(clientId + ":" + secret).toString("base64");
  await withPocketBase(
    async ({ admin, baseUrl, restart }) => {
      const { client } = await createAuthedUser(admin, baseUrl, "mcp-oauth");
      const { client: other } = await createAuthedUser(admin, baseUrl, "mcp-other");
      const rpc = (method, params, authorization, path = mcpPath) =>
        fetch(baseUrl + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            ...(authorization ? { Authorization: authorization } : {}),
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            ...(method.startsWith("notifications/") ? {} : { id: 1 }),
            method,
            params,
          }),
        });
      const tokenRequest = (path, fields, authorization = basic) =>
        fetch(baseUrl + oauthPath + path, {
          method: "POST",
          headers: authorization ? { Authorization: authorization } : {},
          body: new URLSearchParams(fields),
        });

      const init = {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      };
      const unauthorized = await rpc("initialize", init);
      assert.equal(unauthorized.status, 401);
      const metadataPath = "/.well-known/oauth-protected-resource" + mcpPath;
      assert.match(unauthorized.headers.get("www-authenticate"), /resource_metadata=/);
      const metadata = await (await fetch(baseUrl + metadataPath)).json();
      assert.equal(metadata.resource, resource);
      assert.deepEqual(metadata.authorization_servers, [origin]);
      const issuer = await (
        await fetch(baseUrl + "/.well-known/oauth-authorization-server")
      ).json();
      assert.equal(issuer.issuer, origin);
      assert.equal(issuer.authorization_response_iss_parameter_supported, true);
      assert.deepEqual(issuer.code_challenge_methods_supported, ["S256"]);
      assert.equal((await fetch(baseUrl + mcpPath)).status, 405);

      const authorize = {
        response_type: "code",
        redirect_uri: redirectUri,
        client_id: clientId,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        scope: "paideuo:mcp",
        resource,
        state: "state & test",
      };
      const authorizeRequest = (params) =>
        fetch(baseUrl + oauthPath + "/authorize?" + new URLSearchParams(params), {
          redirect: "manual",
        });
      for (const [params, code, detail] of [
        [{ client_id: "wrong-client" }, "invalid_client", /PAIDEUO_MCP_OAUTH_CLIENT_ID/],
        [
          { redirect_uri: "https://example.org/" },
          "invalid_request",
          /PAIDEUO_MCP_OAUTH_REDIRECT_URI/,
        ],
        [{ scope: "openid paideuo:mcp" }, "invalid_scope", /paideuo:mcp/],
        [{ resource: resource + "/" }, "invalid_target", /exact MCP URL/],
        [{ code_challenge_method: "plain" }, "invalid_request", /S256/],
      ]) {
        const invalid = await authorizeRequest({ ...authorize, ...params });
        assert.equal(invalid.status, 400);
        assert.equal(invalid.headers.get("location"), null);
        const error = await invalid.json();
        assert.equal(error.error, code);
        assert.match(error.error_description, detail);
      }
      const start = await authorizeRequest({ ...authorize, scope: "paideuo:mcp paideuo:mcp" });
      assert.equal(start.status, 302);
      const consentUrl = new URL(start.headers.get("location"));
      assert.equal(consentUrl.pathname, "/mcp/authorize");
      const consent = async (approved) =>
        new URL(
          (
            await client.send(oauthPath + "/consent", {
              method: "POST",
              body: { ...Object.fromEntries(consentUrl.searchParams), approved },
            })
          ).redirect,
        );
      const denied = await consent(false);
      assert.equal(denied.searchParams.get("error"), "access_denied");
      assert.equal(denied.searchParams.get("iss"), origin);
      const allowed = await consent(true);
      assert.equal(allowed.searchParams.get("state"), authorize.state);
      assert.equal(allowed.searchParams.get("iss"), origin);

      const exchange = {
        grant_type: "authorization_code",
        code: allowed.searchParams.get("code"),
        redirect_uri: redirectUri,
        code_verifier: verifier,
        resource,
      };
      const badVerifier = await tokenRequest("/token", {
        ...exchange,
        code_verifier: "x".repeat(43),
      });
      assert.equal(badVerifier.status, 400);
      assert.equal((await badVerifier.json()).error, "invalid_grant");
      const wrongResource = await tokenRequest("/token", {
        ...exchange,
        resource: origin + "/other",
      });
      assert.equal((await wrongResource.json()).error, "invalid_target");
      const exchanges = await Promise.all([
        tokenRequest("/token", exchange),
        tokenRequest("/token", exchange),
      ]);
      assert.deepEqual(exchanges.map((response) => response.status).sort(), [200, 400]);
      const tokens = await exchanges.find((response) => response.ok).json();

      const authorization = "Bearer " + tokens.access_token;
      const initialized = await (await rpc("initialize", init, authorization)).json();
      assert.equal(initialized.result.protocolVersion, init.protocolVersion);
      const notification = await rpc("notifications/initialized", {}, authorization);
      assert.equal(notification.status, 202);
      assert.equal(await notification.text(), "");
      const catalog = await (await rpc("tools/list", {}, authorization)).json();
      assert.equal(
        catalog.result.tools.find(({ name }) => name === "list_programs").annotations.readOnlyHint,
        true,
      );
      const create = await (
        await rpc(
          "tools/call",
          {
            name: "create_draft",
            arguments: { name: "OAuth draft", externalId: "oauth-draft" },
          },
          authorization,
        )
      ).json();
      assert.equal(create.result.isError, false, JSON.stringify(create));
      const list = (auth) => rpc("tools/call", { name: "list_programs" }, auth);
      const own = await (await list(authorization)).json();
      assert.match(JSON.stringify(own.result.structuredContent), /OAuth draft/);
      const foreign = await (await list(other.authStore.token)).json();
      assert.doesNotMatch(JSON.stringify(foreign.result.structuredContent), /OAuth draft/);
      assert.equal((await list(client.authStore.token)).status, 200);
      assert.equal(
        (await rpc("tools/list", {}, authorization, "/api/paideuo/v1/service/mcp")).status,
        401,
      );

      await restart();
      const refresh = { grant_type: "refresh_token", refresh_token: tokens.refresh_token };
      const refreshed = await tokenRequest(
        "/token",
        { ...refresh, client_id: clientId, client_secret: secret },
        "",
      );
      const rotated = await refreshed.json();
      assert.equal(refreshed.status, 200, JSON.stringify(rotated));
      assert.equal((await tokenRequest("/token", refresh)).status, 400);
      assert.equal((await list(authorization)).status, 401);
      assert.equal((await list("Bearer " + rotated.access_token)).status, 200);
      assert.equal((await tokenRequest("/revoke", { token: rotated.refresh_token })).status, 200);
      assert.equal((await list("Bearer " + rotated.access_token)).status, 401);

      await admin.collections.delete("paideuo_mcp_oauth_grants");
      await assert.rejects(
        () => consent(true),
        (error) =>
          error.status === 503 &&
          error.response.error === "temporarily_unavailable" &&
          /migration/.test(error.response.error_description),
      );
    },
    {
      env: {
        PAIDEUO_MCP_OAUTH_ORIGIN: origin,
        PAIDEUO_MCP_OAUTH_CLIENT_ID: clientId,
        PAIDEUO_MCP_OAUTH_CLIENT_SECRET: secret,
      },
    },
  );
});
