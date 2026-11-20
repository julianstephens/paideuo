const schema = require(__hooks + "/import-schemas.js");

const previewLifetimeMs = 15 * 60 * 1000;
const maxRequestBytes = 2 * 1024 * 1024;
const rateLimitWindowMs = 60 * 1000;
const rateLimit = 60;
const issuedPreviews = new Map();
const issuedOperations = new Map();
const requestWindows = new Map();

const requestBytes = (value) => {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (0xd800 <= code && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
};

const boundedRequest = (event) => {
  const body = event.requestInfo().body;
  const bytes = requestBytes(JSON.stringify(body ?? null));
  if (bytes > maxRequestBytes) throw new ApiError(413, "Import request exceeds the 2 MB limit.");
  const owner = event.auth.id;
  const now = Date.now();
  const window = requestWindows.get(owner);
  if (!window || window.expiresAt <= now) {
    requestWindows.set(owner, { expiresAt: now + rateLimitWindowMs, count: 1 });
  } else {
    window.count += 1;
    if (window.count > rateLimit) throw new ApiError(429, "Import request rate limit exceeded.");
  }
};

const find = (db, collection, filter, params, sort = "") =>
  db.findRecordsByFilter(collection, filter, sort, 0, 0, params);

const first = (db, collection, filter, params) => find(db, collection, filter, params)[0] ?? null;
const workoutKey = (...parts) => {
  const readable = parts.join("/");
  return readable.length <= 200 ? readable : `workout:${$security.sha256(JSON.stringify(parts))}`;
};

const ownerFilter = (collection, alias = "") => {
  const path = {
    program: `${alias}id = {:id} && ${alias}owner = {:owner}`,
    "program-block": `${alias}id = {:id} && ${alias}program.owner = {:owner}`,
    "program-week": `${alias}id = {:id} && ${alias}block.program.owner = {:owner}`,
    "session-slot": `${alias}id = {:id} && ${alias}block.program.owner = {:owner}`,
    "session-prescription": `${alias}id = {:id} && ${alias}program_week.block.program.owner = {:owner}`,
    "scheduled-session": `${alias}id = {:id} && ${alias}deleted = false && ((${alias}schedule = '' && ${alias}owner = {:owner}) || ${alias}schedule.program.owner = {:owner})`,
  }[collection];
  return path;
};

const authorize = (db, owner) => (type, id) => {
  const collection = {
    program: "paideuo_programs",
    "program-block": "paideuo_blocks",
    "program-week": "paideuo_program_weeks",
    "session-slot": "paideuo_session_slots",
    "scheduled-session": "paideuo_scheduled_sessions",
  }[type];
  return Boolean(collection && first(db, collection, ownerFilter(type), { id, owner }));
};

const normalize = (db, owner, document) =>
  schema.normalize(document, { authorizeReference: authorize(db, owner) });

const recordSnapshot = (record, fields) =>
  record
    ? Object.fromEntries(
        fields.map((field) => {
          const value = field.endsWith("_json")
            ? JSON.parse(record.getString(field.slice(0, -5)) || "null")
            : record.get(field);
          return [field.replace(/_json$/, ""), value];
        }),
      )
    : null;

const chooseRecord = (db, collection, desiredId, externalId, filter, params) => {
  const byExternal = externalId
    ? first(db, collection, `${filter} && external_id = {:externalId}`, { ...params, externalId })
    : null;
  if (!desiredId) return { record: byExternal, byExternal, conflict: false };
  const record = db.findRecordById(collection, desiredId);
  return {
    record,
    byExternal,
    conflict: Boolean(byExternal && byExternal.id !== record.id),
  };
};

const itemStatus = (record, current, desired) =>
  !record ? "create" : JSON.stringify(current) === JSON.stringify(desired) ? "skip" : "update";

const valueFields = (values) => Object.keys(values);

const planRecord = (type, key, record, desired, conflict = false) => {
  const fields = valueFields(desired);
  const current = recordSnapshot(record, fields);
  const comparable = Object.fromEntries(
    Object.entries(desired).map(([field, value]) => [field.replace(/_json$/, ""), value]),
  );
  return {
    item: {
      type,
      key,
      id: record?.id ?? null,
      status: conflict ? "conflict" : itemStatus(record, current, comparable),
    },
    state: { type, key, id: record?.id ?? null, current, desired },
  };
};

const programPlan = (db, owner, data) => {
  const items = [];
  const state = [];
  const add = (type, key, record, desired, conflict = false) => {
    const result = planRecord(type, key, record, desired, conflict);
    items.push(result.item);
    state.push(result.state);
  };
  const program = data.program;
  const programChoice = chooseRecord(
    db,
    "paideuo_programs",
    program.id,
    program.externalId,
    "owner = {:owner}",
    { owner },
  );
  add(
    "program",
    program.externalId,
    programChoice.record,
    {
      external_id: program.externalId,
      name: program.name,
      objective: program.objective,
      description: program.description,
      status: program.status ?? programChoice.record?.getString("status") ?? "draft",
    },
    programChoice.conflict,
  );
  const programId = programChoice.record?.id ?? null;

  for (const block of data.blocks) {
    const blockChoice = chooseRecord(
      db,
      "paideuo_blocks",
      block.id,
      block.externalId,
      programId ? "program = {:programId}" : "id = ''",
      { programId },
    );
    const blockConflict =
      blockChoice.conflict ||
      Boolean(block.id && blockChoice.record.getString("program") !== programId);
    const occupiedBlock = programId
      ? first(
          db,
          "paideuo_blocks",
          "program = {:programId} && position = {:position} && id != {:id}",
          { programId, position: block.position, id: blockChoice.record?.id ?? "" },
        )
      : null;
    const occupiedBlockConflict =
      occupiedBlock &&
      !data.blocks.some(
        (candidate) =>
          candidate.id === occupiedBlock.id ||
          candidate.externalId === occupiedBlock.getString("external_id"),
      );
    add(
      "block",
      block.externalId,
      blockChoice.record,
      {
        external_id: block.externalId,
        name: block.name,
        objective: block.objective,
        position: block.position,
        duration_weeks: block.durationWeeks,
      },
      blockConflict || Boolean(occupiedBlockConflict),
    );
    const blockId = blockChoice.record?.id ?? null;
    for (const slot of block.slots) {
      const slotChoice = chooseRecord(
        db,
        "paideuo_session_slots",
        slot.id,
        slot.externalId,
        blockId ? "block = {:blockId}" : "id = ''",
        { blockId },
      );
      const occupiedSlot = blockId
        ? first(
            db,
            "paideuo_session_slots",
            "block = {:blockId} && position = {:position} && id != {:id}",
            { blockId, position: slot.position, id: slotChoice.record?.id ?? "" },
          )
        : null;
      const positionConflict =
        occupiedSlot &&
        !block.slots.some(
          (candidate) =>
            candidate.id === occupiedSlot.id ||
            candidate.externalId === occupiedSlot.getString("external_id"),
        );
      add(
        "slot",
        slot.externalId,
        slotChoice.record,
        {
          external_id: slot.externalId,
          weekday: slot.weekday,
          position: slot.position,
          label: slot.label,
        },
        slotChoice.conflict ||
          Boolean(slot.id && slotChoice.record.getString("block") !== blockId) ||
          Boolean(positionConflict),
      );
    }
    for (const week of block.weeks) {
      const weekChoice = chooseRecord(
        db,
        "paideuo_program_weeks",
        week.id,
        week.externalId,
        blockId ? "block = {:blockId}" : "id = ''",
        { blockId },
      );
      const occupiedWeek = blockId
        ? first(
            db,
            "paideuo_program_weeks",
            "block = {:blockId} && position = {:position} && id != {:id}",
            { blockId, position: week.position, id: weekChoice.record?.id ?? "" },
          )
        : null;
      const positionConflict =
        occupiedWeek &&
        !block.weeks.some(
          (candidate) =>
            candidate.id === occupiedWeek.id ||
            candidate.externalId === occupiedWeek.getString("external_id"),
        );
      add(
        "week",
        week.externalId,
        weekChoice.record,
        {
          external_id: week.externalId,
          position: week.position,
          label: week.label,
          focus: week.focus,
          week_type: week.weekType,
        },
        weekChoice.conflict ||
          Boolean(week.id && weekChoice.record.getString("block") !== blockId) ||
          Boolean(positionConflict),
      );
      const weekId = weekChoice.record?.id ?? null;
      for (const prescription of week.prescriptions) {
        const key = workoutKey(
          data.program.externalId,
          block.externalId,
          week.externalId,
          prescription.slotExternalId,
        );
        const slot = block.slots.find(
          (candidate) => candidate.externalId === prescription.slotExternalId,
        );
        const slotChoice = chooseRecord(
          db,
          "paideuo_session_slots",
          slot.id,
          slot.externalId,
          blockId ? "block = {:blockId}" : "id = ''",
          { blockId },
        );
        const bySlot =
          weekId && slotChoice.record
            ? first(
                db,
                "paideuo_session_prescriptions",
                "program_week = {:weekId} && slot = {:slotId}",
                { weekId, slotId: slotChoice.record.id },
              )
            : null;
        const prescriptionChoice = weekId
          ? chooseRecord(
              db,
              "paideuo_session_prescriptions",
              null,
              key,
              "program_week = {:weekId}",
              { weekId },
            )
          : { record: null, byExternal: null, conflict: false };
        if (!prescriptionChoice.record && bySlot) prescriptionChoice.record = bySlot;
        prescriptionChoice.conflict =
          prescriptionChoice.conflict ||
          Boolean(
            bySlot &&
            prescriptionChoice.byExternal &&
            bySlot.id !== prescriptionChoice.byExternal.id,
          );
        const workout = prescription.workout;
        add(
          "prescription",
          key,
          prescriptionChoice.record,
          {
            external_id: key,
            slot: slotChoice.record?.id ?? prescription.slotExternalId,
            title: workout.title,
            description: workout.description,
            planned_duration_min: workout.plannedDurationMin ?? 0,
            duration_specified: workout.plannedDurationMin !== null,
            planned_intensity: workout.plannedIntensity ?? "",
            notes: workout.notes,
            session_type: workout.sessionType,
          },
          prescriptionChoice.conflict,
        );
        state.push({
          type: "prescription-components",
          key,
          current: prescriptionChoice.record
            ? find(
                db,
                "paideuo_training_components",
                "prescription = {:id}",
                { id: prescriptionChoice.record.id },
                "position",
              ).map((component) =>
                recordSnapshot(component, [
                  "name",
                  "instructions",
                  "duration_min",
                  "duration_specified",
                  "targets_json",
                ]),
              )
            : [],
          desired: workout.components,
        });
        const componentState = state[state.length - 1];
        const currentComponents = componentState.current.map((component) => ({
          name: component.name,
          instructions: component.instructions,
          durationMin: component.duration_specified ? component.duration_min : null,
          targets: component.targets,
        }));
        const item = items[items.length - 1];
        if (
          item?.status === "skip" &&
          JSON.stringify(currentComponents) !== JSON.stringify(workout.components)
        ) {
          item.status = "update";
        }
      }
    }
  }
  return { items, state };
};

const byExternalPrescription = (db, owner, key) => {
  const prescriptions = find(
    db,
    "paideuo_session_prescriptions",
    "external_id = {:key} && program_week.block.program.owner = {:owner}",
    { key, owner },
  );
  return prescriptions.length === 1 ? prescriptions[0] : null;
};

const findResultSession = (db, owner, sourceSessionId, sourceWorkoutKey, date) => {
  if (sourceSessionId) return db.findRecordById("paideuo_scheduled_sessions", sourceSessionId);
  const prescription = byExternalPrescription(db, owner, sourceWorkoutKey);
  if (!prescription) return null;
  const rows = find(
    db,
    "paideuo_scheduled_sessions",
    "deleted = false && source_prescription_id = {:id} && scheduled_date = {:date} && schedule.program.owner = {:owner}",
    { id: prescription.id, date, owner },
  );
  return rows.length === 1 ? rows[0] : null;
};

const dailyDesired = (entry) => ({
  date: entry.date,
  measurements_json: { ...entry.recovery },
  nutrition_json: { ...entry.nutrition },
});

const observationPlan = (db, owner, document) => {
  const items = [];
  const state = [];
  if (document.kind === "daily-check-ins") {
    for (const entry of document.data.entries) {
      const record = first(db, "paideuo_daily_recovery", "owner = {:owner} && date = {:date}", {
        owner,
        date: entry.date,
      });
      const desired = dailyDesired(entry);
      const result = planRecord("daily-check-in", entry.date, record, desired);
      items.push(result.item);
      state.push({ ...result.state, entry });
    }
    return { items, state };
  }
  if (document.kind === "workout-component-results") {
    const data = document.data;
    const session = findResultSession(
      db,
      owner,
      data.sourceSessionId,
      data.sourceWorkoutKey,
      data.completedDate,
    );
    if (!session) {
      return {
        items: [
          {
            type: "workout-component-results",
            key: data.sourceWorkoutKey,
            id: null,
            status: "conflict",
            error: "No unique owned scheduled workout matches the source.",
          },
        ],
        state: [{ type: "unresolved-session", key: data.sourceWorkoutKey }],
      };
    }
    const scheduleId = session.getString("schedule");
    const timezone = scheduleId
      ? db.findRecordById("paideuo_program_schedules", scheduleId).getString("timezone")
      : session.getString("timezone");
    const today = require(__hooks + "/calendar-sessions.js").todayIn(timezone);
    if (data.completedDate > today) {
      return {
        items: [
          {
            type: "workout-component-results",
            key: data.sourceWorkoutKey,
            id: session.id,
            status: "conflict",
            error: "Completion date is later than the workout timezone's current date.",
          },
        ],
        state: [{ type: "future-completion", key: data.sourceWorkoutKey, today }],
      };
    }
    const completion = first(db, "paideuo_session_completions", "session = {:id}", {
      id: session.id,
    });
    const desiredCompletion = {
      completed_date: data.completedDate,
      actual_duration_min_json: data.actualDurationMin,
      session_rpe_json: data.sessionRpe,
      notes: data.notes,
    };
    const completionPlan = planRecord(
      "workout-result",
      data.sourceWorkoutKey,
      completion,
      desiredCompletion,
    );
    const componentRows = find(
      db,
      "paideuo_workout_component_results",
      "session = {:id}",
      { id: session.id },
      "planned_position",
    );
    state.push({
      ...completionPlan.state,
      sessionId: session.id,
      session: recordSnapshot(session, [
        "schedule",
        "source_prescription_id",
        "scheduled_date",
        "original_date",
        "status",
        "deleted",
        "manually_moved",
        "manually_edited",
        "prescription_snapshot_json",
      ]),
      components: data.components,
      currentComponents: componentRows.map((row) =>
        recordSnapshot(row, [
          "component_key",
          "planned_position",
          "name",
          "completed",
          "actual_duration_min_json",
          "sets_completed_json",
          "reps_completed",
          "actual_load_json",
          "rpe_json",
          "notes",
        ]),
      ),
      desiredComponents: data.components,
    });
    const normalizedCurrentComponents = state[0].currentComponents.map((component) => ({
      key: component.component_key,
      plannedPosition: component.planned_position,
      name: component.name,
      completed: component.completed,
      actualDurationMin: component.actual_duration_min,
      setsCompleted: component.sets_completed,
      repsCompleted: component.reps_completed || null,
      actualLoad: component.actual_load,
      rpe: component.rpe,
      notes: component.notes,
    }));
    if (
      completionPlan.item.status === "skip" &&
      JSON.stringify(normalizedCurrentComponents) !== JSON.stringify(data.components)
    ) {
      completionPlan.item.status = "update";
    }
    if (
      completion &&
      completionPlan.item.status === "update" &&
      !data.replaceExistingCompletion
    ) {
      completionPlan.item.status = "conflict";
      completionPlan.item.error =
        "Replacing existing completed workout results requires explicit historical replacement authorization.";
    }
    items.push(completionPlan.item);
    return { items, state };
  }

  const data = document.data;
  const byExternal = data.externalId
    ? first(
        db,
        "paideuo_heart_rate_recordings",
        "owner = {:owner} && external_id = {:externalId}",
        { owner, externalId: data.externalId },
      )
    : null;
  const byWorkout = first(
    db,
    "paideuo_heart_rate_recordings",
    "owner = {:owner} && external_id = '' && source_workout_key = {:key}",
    { owner, key: data.sourceWorkoutKey },
  );
  const record = byExternal ?? byWorkout;
  const session = findResultSession(
    db,
    owner,
    data.sourceSessionId,
    data.sourceWorkoutKey,
    new DateTime(data.startedAt).time().in(new Timezone(data.timezone)).format("2006-01-02"),
  );
  const desired = {
    source_workout_key: data.sourceWorkoutKey,
    session: session?.id ?? "",
    started_at: data.startedAt,
    ended_at: data.endedAt,
    timezone: data.timezone,
    device_json: data.device,
    provider: data.provider ?? "",
    external_id: data.externalId ?? "",
    sample_interval_seconds_json: data.sampleIntervalSeconds,
    sample_count_json: data.sampleCount,
    units: data.units,
    algorithm_json: data.algorithm,
  };
  const result = planRecord(
    "heart-rate-recording",
    data.externalId ?? data.sourceWorkoutKey,
    record,
    desired,
    Boolean(
      (byExternal && byExternal.getString("source_workout_key") !== data.sourceWorkoutKey) ||
      (byExternal && byWorkout && byExternal.id !== byWorkout.id),
    ),
  );
  if (!session && data.sourceSessionId) result.item.status = "conflict";
  state.push({
    ...result.state,
    sessionId: session?.id ?? null,
    session: session
      ? recordSnapshot(session, [
          "schedule",
          "source_prescription_id",
          "scheduled_date",
          "original_date",
          "status",
          "deleted",
          "manually_moved",
          "manually_edited",
          "prescription_snapshot_json",
        ])
      : null,
  });
  return { items: [result.item], state };
};

const plan = (db, owner, document) =>
  document.kind === "program"
    ? programPlan(db, owner, document.data)
    : observationPlan(db, owner, document);

const preparePreview = (db, owner, document) => {
  const normalized = normalize(db, owner, document);
  const result = plan(db, owner, normalized);
  const fingerprint = JSON.stringify({ schema: normalized, state: result.state });
  return { document: normalized, fingerprint, plan: result };
};

const preview = (db, owner, document) => {
  const prepared = preparePreview(db, owner, document);
  const now = Date.now();
  for (const [token, issued] of issuedPreviews) {
    if (issued.expiresAt <= now) issuedPreviews.delete(token);
  }
  if (issuedPreviews.size >= 10000) issuedPreviews.delete(issuedPreviews.keys().next().value);
  const token = $security.sha256(`${$security.randomString(32)}:${owner}:${prepared.fingerprint}`);
  issuedPreviews.set(token, {
    consumed: false,
    expiresAt: now + previewLifetimeMs,
    fingerprint: prepared.fingerprint,
    owner,
  });
  return {
    document: prepared.document,
    result: {
      previewToken: token,
      schema: prepared.document.schema,
      version: prepared.document.version,
      kind: prepared.document.kind,
      items: prepared.plan.items,
      conflicting: prepared.plan.items.filter((item) => item.status === "conflict").length,
    },
  };
};

const verifyPreview = (db, owner, document, token) => {
  const issued = issuedPreviews.get(token);
  if (!issued || issued.owner !== owner || issued.expiresAt <= Date.now()) {
    throw new ApiError(409, "This import preview is stale or has been tampered with.");
  }
  if (issued.consumed) {
    throw new ApiError(409, "This import preview has already been committed.");
  }
  const prepared = preparePreview(db, owner, document);
  if (issued.fingerprint !== prepared.fingerprint) {
    throw new ApiError(409, "This import preview is stale or has been tampered with.");
  }
  if (prepared.plan.items.some((item) => item.status === "conflict")) {
    throw new ApiError(409, "Resolve every conflicting import item before committing.");
  }
  return { ...prepared, issued };
};

const save = (db, collection, fields) => {
  const record = new Record(db.findCollectionByNameOrId(collection), fields);
  db.save(record);
  return record;
};

const update = (db, record, values) => {
  for (const [field, value] of Object.entries(values)) record.set(field, value);
  db.save(record);
  return record;
};

const trainingComponentValues = (component, position) => ({
  position,
  name: component.name,
  instructions: component.instructions,
  duration_min: component.durationMin ?? 0,
  duration_specified: component.durationMin !== null,
  targets: component.targets,
});

const sameTrainingComponent = (record, values) =>
  record.getInt("position") === values.position &&
  record.getString("name") === values.name &&
  record.getString("instructions") === values.instructions &&
  record.getInt("duration_min") === values.duration_min &&
  record.getBool("duration_specified") === values.duration_specified &&
  JSON.stringify(record.get("targets")) === JSON.stringify(values.targets);

const reconcileTrainingComponents = (db, prescriptionId, components) => {
  const existing = find(
    db,
    "paideuo_training_components",
    "prescription = {:id}",
    { id: prescriptionId },
    "position,id",
  );
  const max = Math.max(existing.length, components.length);
  for (let index = 0; index < max; index += 1) {
    const current = existing[index] ?? null;
    const desired = components[index] ?? null;
    if (!desired) {
      if (current) db.delete(current);
      continue;
    }
    const values = trainingComponentValues(desired, index + 1);
    if (!current) {
      save(db, "paideuo_training_components", { prescription: prescriptionId, ...values });
      continue;
    }
    if (!sameTrainingComponent(current, values)) update(db, current, values);
  }
};

const commitProgram = (db, owner, document, plan) => {
  const data = document.data;
  const planned = new Map(plan.items.map((item) => [`${item.type}:${item.key}`, item.status]));
  const statusFor = (type, key) => planned.get(`${type}:${key}`) ?? "create";
  if (plan.items.every((item) => item.status === "skip")) {
    return {
      programId: data.program.id ?? plan.items[0]?.id,
      scheduleSynchronization: null,
      unchanged: true,
    };
  }
  let program = data.program.id
    ? db.findRecordById("paideuo_programs", data.program.id)
    : first(db, "paideuo_programs", "owner = {:owner} && external_id = {:externalId}", {
        owner,
        externalId: data.program.externalId,
      });
  const programFields = {
    owner,
    external_id: data.program.externalId,
    name: data.program.name,
    objective: data.program.objective,
    description: data.program.description,
    status: data.program.status ?? program?.getString("status") ?? "draft",
  };
  program = !program
    ? save(db, "paideuo_programs", programFields)
    : statusFor("program", data.program.externalId) === "skip"
      ? program
      : update(db, program, programFields);

  const allBlocks = find(db, "paideuo_blocks", "program = {:program}", {
    program: program.id,
  });
  const desiredBlocks = data.blocks.flatMap((block) => {
    if (statusFor("block", block.externalId) === "skip") return [];
    const record = block.id
      ? db.findRecordById("paideuo_blocks", block.id)
      : first(db, "paideuo_blocks", "program = {:program} && external_id = {:externalId}", {
          program: program.id,
          externalId: block.externalId,
        });
    return record ? [record] : [];
  });
  const maxBlockPosition = Math.max(0, ...allBlocks.map((record) => record.getInt("position")));
  desiredBlocks.forEach((record, index) =>
    update(db, record, { position: maxBlockPosition + index + 1 }),
  );
  const blockRecords = new Map();
  for (const block of data.blocks) {
    let record = block.id
      ? db.findRecordById("paideuo_blocks", block.id)
      : first(db, "paideuo_blocks", "program = {:program} && external_id = {:externalId}", {
          program: program.id,
          externalId: block.externalId,
        });
    const fields = {
      program: program.id,
      external_id: block.externalId,
      name: block.name,
      objective: block.objective,
      position: block.position,
      duration_weeks: block.durationWeeks,
    };
    record = !record
      ? save(db, "paideuo_blocks", fields)
      : statusFor("block", block.externalId) === "skip"
        ? record
        : update(db, record, fields);
    blockRecords.set(block.externalId, record);
  }

  for (const block of data.blocks) {
    const blockRecord = blockRecords.get(block.externalId);
    const slotRecords = new Map();
    for (const slot of block.slots) {
      let record = slot.id
        ? db.findRecordById("paideuo_session_slots", slot.id)
        : first(db, "paideuo_session_slots", "block = {:block} && external_id = {:externalId}", {
            block: blockRecord.id,
            externalId: slot.externalId,
          });
      const fields = {
        block: blockRecord.id,
        external_id: slot.externalId,
        weekday: slot.weekday,
        position: slot.position,
        label: slot.label,
      };
      record = !record
        ? save(db, "paideuo_session_slots", fields)
        : statusFor("slot", slot.externalId) === "skip"
          ? record
          : update(db, record, fields);
      slotRecords.set(slot.externalId, record);
    }
    const allWeeks = find(db, "paideuo_program_weeks", "block = {:block}", {
      block: blockRecord.id,
    });
    const desiredWeeks = block.weeks.flatMap((week) => {
      if (statusFor("week", week.externalId) === "skip") return [];
      const record = week.id
        ? db.findRecordById("paideuo_program_weeks", week.id)
        : first(db, "paideuo_program_weeks", "block = {:block} && external_id = {:externalId}", {
            block: blockRecord.id,
            externalId: week.externalId,
          });
      return record ? [record] : [];
    });
    const maxWeekPosition = Math.max(0, ...allWeeks.map((record) => record.getInt("position")));
    desiredWeeks.forEach((record, index) =>
      update(db, record, { position: maxWeekPosition + index + 1 }),
    );
    for (const week of block.weeks) {
      let weekRecord = week.id
        ? db.findRecordById("paideuo_program_weeks", week.id)
        : first(db, "paideuo_program_weeks", "block = {:block} && external_id = {:externalId}", {
            block: blockRecord.id,
            externalId: week.externalId,
          });
      const weekFields = {
        block: blockRecord.id,
        external_id: week.externalId,
        position: week.position,
        label: week.label,
        focus: week.focus,
        week_type: week.weekType,
      };
      weekRecord = !weekRecord
        ? save(db, "paideuo_program_weeks", weekFields)
        : statusFor("week", week.externalId) === "skip"
          ? weekRecord
          : update(db, weekRecord, weekFields);
      for (const item of week.prescriptions) {
        const key = workoutKey(
          data.program.externalId,
          block.externalId,
          week.externalId,
          item.slotExternalId,
        );
        const slotRecord = slotRecords.get(item.slotExternalId);
        let prescription = first(
          db,
          "paideuo_session_prescriptions",
          "program_week = {:week} && external_id = {:key}",
          { week: weekRecord.id, key },
        );
        prescription ??= first(
          db,
          "paideuo_session_prescriptions",
          "program_week = {:week} && slot = {:slot}",
          { week: weekRecord.id, slot: slotRecord.id },
        );
        const fields = {
          program_week: weekRecord.id,
          slot: slotRecord.id,
          external_id: key,
          title: item.workout.title,
          description: item.workout.description,
          planned_duration_min: item.workout.plannedDurationMin ?? 0,
          duration_specified: item.workout.plannedDurationMin !== null,
          planned_intensity: item.workout.plannedIntensity ?? "",
          notes: item.workout.notes,
          session_type: item.workout.sessionType,
        };
        const status = statusFor("prescription", key);
        prescription = !prescription
          ? save(db, "paideuo_session_prescriptions", fields)
          : status === "skip"
            ? prescription
            : update(db, prescription, fields);
        if (status !== "skip") {
          reconcileTrainingComponents(db, prescription.id, item.workout.components);
        }
      }
    }
  }
  const scheduled = Boolean(
    first(db, "paideuo_program_schedules", "program = {:program}", { program: program.id }),
  );
  return {
    programId: program.id,
    scheduleSynchronization: scheduled ? "review-required" : null,
  };
};

const commitDaily = (db, owner, data, plan) => {
  const statuses = [];
  for (const [index, entry] of data.entries.entries()) {
    const planned = plan.items[index];
    if (planned.status === "skip") {
      statuses.push({ key: entry.date, status: "skipped" });
      continue;
    }
    const record = first(db, "paideuo_daily_recovery", "owner = {:owner} && date = {:date}", {
      owner,
      date: entry.date,
    });
    const saved = record ?? new Record(db.findCollectionByNameOrId("paideuo_daily_recovery"));
    saved.set("owner", owner);
    saved.set("date", entry.date);
    saved.set("measurements", entry.recovery);
    saved.set("nutrition", entry.nutrition);
    db.save(saved);
    statuses.push({ key: entry.date, status: record ? "updated" : "created" });
  }
  return statuses;
};

const commitWorkout = (db, owner, data, plan) => {
  if (plan.items[0].status === "skip") {
    return [{ key: data.sourceWorkoutKey, status: "skipped" }];
  }
  const state = plan.state[0];
  if (!state.sessionId)
    throw new ApiError(409, state.item?.error ?? "Scheduled workout not found.");
  let completion = first(db, "paideuo_session_completions", "session = {:session}", {
    session: state.sessionId,
  });
  if (completion && plan.items[0].status === "update" && !data.replaceExistingCompletion) {
    throw new ApiError(
      409,
      "Replacing existing completed workout results requires explicit historical replacement authorization.",
    );
  }
  completion = completion ?? new Record(db.findCollectionByNameOrId("paideuo_session_completions"));
  completion.set("session", state.sessionId);
  completion.set("completed_date", data.completedDate);
  completion.set("actual_duration_min", data.actualDurationMin);
  completion.set("session_rpe", data.sessionRpe);
  completion.set("notes", data.notes);
  db.save(completion);
  for (const old of find(db, "paideuo_workout_component_results", "session = {:session}", {
    session: state.sessionId,
  })) {
    db.delete(old);
  }
  for (const component of data.components) {
    save(db, "paideuo_workout_component_results", {
      session: state.sessionId,
      component_key: component.key,
      planned_position: component.plannedPosition,
      name: component.name,
      completed: component.completed,
      actual_duration_min: component.actualDurationMin,
      sets_completed: component.setsCompleted,
      reps_completed: component.repsCompleted ?? "",
      actual_load: component.actualLoad,
      rpe: component.rpe,
      notes: component.notes,
    });
  }
  const session = db.findRecordById("paideuo_scheduled_sessions", state.sessionId);
  session.set("status", "completed");
  db.save(session);
  return [{ key: data.sourceWorkoutKey, status: "committed" }];
};

const commitHeartRate = (db, owner, data, plan) => {
  if (plan.items[0].status === "skip") {
    return [{ key: data.sourceWorkoutKey, status: "skipped" }];
  }
  const state = plan.state[0];
  const byExternal = data.externalId
    ? first(
        db,
        "paideuo_heart_rate_recordings",
        "owner = {:owner} && external_id = {:externalId}",
        { owner, externalId: data.externalId },
      )
    : null;
  const byWorkout = first(
    db,
    "paideuo_heart_rate_recordings",
    "owner = {:owner} && external_id = '' && source_workout_key = {:key}",
    { owner, key: data.sourceWorkoutKey },
  );
  let record = byExternal ?? byWorkout;
  record = record ?? new Record(db.findCollectionByNameOrId("paideuo_heart_rate_recordings"));
  record.set("owner", owner);
  record.set("session", state.sessionId ?? "");
  record.set("source_workout_key", data.sourceWorkoutKey);
  record.set("started_at", data.startedAt);
  record.set("ended_at", data.endedAt);
  record.set("timezone", data.timezone);
  record.set("device", data.device);
  record.set("provider", data.provider ?? "");
  record.set("external_id", data.externalId ?? "");
  record.set("sample_interval_seconds", data.sampleIntervalSeconds);
  record.set("sample_count", data.sampleCount);
  record.set("units", data.units);
  record.set("algorithm", data.algorithm);
  db.save(record);
  return [{ key: data.sourceWorkoutKey, status: state.id ? "updated" : "created" }];
};

const operationIdValue = (body) => {
  if (body.operationId == null) return null;
  if (
    typeof body.operationId !== "string" ||
    body.operationId.length < 1 ||
    body.operationId.length > 200 ||
    !/^[A-Za-z0-9._:-]+$/.test(body.operationId)
  ) {
    throw new BadRequestError("Enter a valid import operationId.");
  }
  return body.operationId;
};

const payloadHash = (document) =>
  $security.sha256(JSON.stringify(document));

const provenanceValue = (body, owner) => {
  const source = body.provenance && typeof body.provenance === "object" ? body.provenance : {};
  const textValue = (value, fallback, maximum) =>
    typeof value === "string" && value.length <= maximum ? value : fallback;
  const sourceLabel = textValue(
    body.sourceLabel ?? source.sourceLabel,
    "api",
    200,
  );
  const credentialRef = textValue(
    body.credentialRef ?? body.credential ?? source.credentialRef ?? source.credential,
    "",
    200,
  );
  const importTimestamp =
    typeof (body.importTimestamp ?? body.importedAt ?? source.importedAt) === "string"
      ? body.importTimestamp ?? body.importedAt ?? source.importedAt
      : new Date().toISOString();
  if (importTimestamp.length > 100) throw new BadRequestError("Enter a valid import timestamp.");
  return {
    sourceLabel,
    actor: owner,
    credentialRef,
    importedAt: importTimestamp,
  };
};

const auditSummary = (rows) => {
  const summary = { created: 0, updated: 0, skipped: 0, conflict: 0 };
  for (const row of Array.isArray(rows) ? rows : []) {
    const status = typeof row === "object" ? row.status : null;
    if (status === "created") summary.created += 1;
    else if (status === "updated") summary.updated += 1;
    else if (status === "skipped") summary.skipped += 1;
    else if (status === "conflict") summary.conflict += 1;
  }
  return summary;
};

const findOperation = (db, owner, operationId) => {
  const memory = issuedOperations.get(`${owner}:${operationId}`);
  if (memory) return memory;
  try {
    const record = first(
      db,
      "paideuo_import_operations",
      "owner = {:owner} && operation_id = {:operationId}",
      { owner, operationId },
    );
    if (!record) return null;
    return {
      payloadHash: record.getString("payload_hash"),
      result: JSON.parse(record.getString("result_json")),
      provenance: JSON.parse(record.getString("provenance_json")),
      summary: JSON.parse(record.getString("summary_json")),
    };
  } catch (_error) {
    return null;
  }
};

const saveOperation = (db, owner, operationId, hash, provenance, response) => {
  const record = new Record(db.findCollectionByNameOrId("paideuo_import_operations"));
  record.set("owner", owner);
  record.set("operation_id", operationId);
  record.set("payload_hash", hash);
  record.set("status", "committed");
  record.set("provenance_json", provenance);
  record.set("summary_json", auditSummary(response.rows));
  record.set("result_json", response);
  db.save(record);
};

const commit = (event) => {
  boundedRequest(event);
  const body = event.requestInfo().body;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) =>
      ![
        "previewToken",
        "document",
        "operationId",
        "provenance",
        "sourceLabel",
        "actor",
        "credential",
        "credentialRef",
        "importedAt",
        "importTimestamp",
      ].includes(key),
    ) ||
    typeof body.previewToken !== "string" ||
    !body.document
  ) {
    throw new BadRequestError("Enter a valid import commit.");
  }
  const owner = event.auth.id;
  const operationId = operationIdValue(body);
  const provenance = provenanceValue(body, owner);
  let result;
  let issued;
  let preparedHash = null;
  let response = null;

  if (operationId) {
    const existing = findOperation(event.app, owner, operationId);
    if (existing) {
      const normalized = normalize(event.app, owner, body.document);
      const replayHash = payloadHash(normalized);
      if (existing.payloadHash !== replayHash) {
        throw new ApiError(409, "This operationId is already used with different import payload.");
      }
      return event.json(200, existing.result);
    }
  }

  try {
    event.app.runInTransaction((tx) => {
      const verified = verifyPreview(tx, owner, body.document, body.previewToken);
      issued = verified.issued;
      issued.consumed = true;
      const document = verified.document;
      preparedHash = payloadHash(document);
      if (document.kind === "program") result = commitProgram(tx, owner, document, verified.plan);
      else if (document.kind === "daily-check-ins")
        result = commitDaily(tx, owner, document.data, verified.plan);
      else if (document.kind === "workout-component-results")
        result = commitWorkout(tx, owner, document.data, verified.plan);
      else result = commitHeartRate(tx, owner, document.data, verified.plan);
      if (operationId) {
        const existing = findOperation(tx, owner, operationId);
        if (existing) {
          if (existing.payloadHash !== preparedHash) {
            throw new ApiError(409, "This operationId is already used with different import payload.");
          }
          return;
        }
        const summary = auditSummary(result);
        const auditResponse = {
          committed: true,
          rows: result,
          operationId,
          payloadHash: preparedHash,
          audit: { operationId, payloadHash: preparedHash, provenance, summary },
        };
        response = auditResponse;
        saveOperation(tx, owner, operationId, preparedHash, provenance, auditResponse);
      }
    });
  } catch (error) {
    if (issued) issued.consumed = false;
    throw error;
  }
  if (operationId && response) {
    issuedOperations.set(`${owner}:${operationId}`, {
      payloadHash: preparedHash,
      result: response,
      provenance,
      summary: auditSummary(result),
    });
  }
  return event.json(200, response ?? { committed: true, rows: result });
};

const previewRequest = (event) => {
  boundedRequest(event);
  return event.json(200, preview(event.app, event.auth.id, event.requestInfo().body).result);
};

// oxlint-disable-next-line import/no-commonjs
module.exports = { commit, preview: previewRequest };
