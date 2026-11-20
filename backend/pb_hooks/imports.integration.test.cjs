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
                    { name: "Warm-up", instructions: "", durationMin: 10, targets: null },
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
                    { name: "Main set", instructions: "", durationMin: 20, targets: null },
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
onRecordValidate((event) => {
  if (event.record.getString("measurements").includes("__INJECT_NESTED_FAIL__")) {
    throw new BadRequestError("Injected check-in write failure.");
  }
  event.next();
}, "paideuo_daily_recovery");
`,
    "utf8",
  );

  const superuserEmail = "imports-it-superuser@example.com";
  const superuserPassword = "Password123!";
  pocketbaseCreateOrUpdateSuperuser(dataDir, hooksDir, superuserEmail, superuserPassword);

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const startServer = () =>
    spawn(
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

    const owner = await createAuthedUser(admin, baseUrl, "owner");
    const intruder = await createAuthedUser(admin, baseUrl, "intruder");

    const initialDocument = makeProgramDocument();
    const domainProgramBody = { ...initialDocument.data, operationId: "domain-program" };
    const domainProgram = await domainRequest(intruder.client, "programs", domainProgramBody);
    assert.equal(domainProgram.created, 1);
    assert.equal(domainProgram.rows[0].status, "created");
    const domainProgramRecord = await admin
      .collection("paideuo_programs")
      .getOne(domainProgram.rows[0].programId);
    assert.equal(domainProgramRecord.owner, intruder.userId);
    assert.equal(domainProgramRecord.external_id, initialDocument.data.program.externalId);

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

    await stopServer(server);
    server = startServer();
    await waitForHealth(baseUrl, 20000, server);
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

    const prescriptions = (
      await admin.collection("paideuo_session_prescriptions").getFullList()
    ).filter((row) => weekIds.has(row.program_week));
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
        components: [],
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
  } finally {
    if (server.exitCode === null) await stopServer(server);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
