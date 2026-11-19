const handlePrograms = (event) => {
  const path = event.request.pathValue("path");
  const [id, action, blockId, blockAction, slotId, slotAction, ...remaining] = path.split("/");
  const method = event.request.method;
  const owner = event.auth.id;
  const body = event.requestInfo().body;
  const app = event.app;

  const find = (db, collection, filter, params, sort = "") =>
    db.findRecordsByFilter(collection, filter, sort, 0, 0, params);

  const ownProgram = (db, id) => {
    const [program] = find(db, "paideuo_programs", "id = {:id} && owner = {:owner}", { id, owner });
    if (!program) throw new NotFoundError("Program not found.");
    return program;
  };

  const children = (db, collection, relation, parent, sort = "") =>
    find(db, collection, `${relation} = {:parent}`, { parent }, sort);

  const save = (db, collection, fields) => {
    const record = new Record(db.findCollectionByNameOrId(collection), fields);
    db.save(record);
    return record;
  };

  const text = (key, max, required = false) => {
    const value = body[key] === undefined ? "" : body[key];
    if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) {
      throw new BadRequestError(`Enter a valid ${key}.`);
    }
    return value.trim();
  };

  const fields = () => ({
    name: text("name", 200, true),
    objective: text("objective", 10000),
    description: text("description", 10000),
  });

  const blockData = (block) => ({
    id: block.id,
    name: block.getString("name"),
    objective: block.getString("objective"),
    position: block.getInt("position"),
    durationWeeks: block.getInt("duration_weeks"),
  });

  const scheduleFor = (db, program) =>
    find(db, "paideuo_program_schedules", "program = {:program}", { program })[0];

  const scheduleData = (record) => ({
    id: record.id,
    startDate: record.getString("start_date"),
    timezone: record.getString("timezone"),
    status: record.getString("status"),
  });

  const programData = (program, blocks, schedule) => ({
    id: program.id,
    name: program.getString("name"),
    objective: program.getString("objective"),
    description: program.getString("description"),
    status: program.getString("status"),
    blockCount: blocks.length,
    weekCount: blocks.reduce((total, block) => total + block.getInt("duration_weeks"), 0),
    scheduled: Boolean(schedule),
  });

  const copyFields = (record, keys) =>
    Object.fromEntries(keys.map((key) => [key, record.get(key)]));
  const slotsFor = (db, blockId) =>
    children(db, "paideuo_session_slots", "block", blockId, "weekday,position,id");

  const ownBlock = (db, blockId, programId) => {
    const [block] = find(db, "paideuo_blocks", "id = {:blockId} && program.owner = {:owner}", {
      blockId,
      owner,
    });
    if (!block || (programId !== undefined && block.getString("program") !== programId)) {
      throw new NotFoundError("Block not found.");
    }
    return block;
  };

  const nextBlockPosition = (db, programId) => {
    const [last] = db.findRecordsByFilter(
      "paideuo_blocks",
      "program = {:programId}",
      "-position",
      1,
      0,
      { programId },
    );
    return last ? last.getInt("position") + 1 : 1;
  };

  const durationWeeks = () => {
    const duration = body.durationWeeks;
    if (!Number.isInteger(duration) || duration < 1 || duration > 520) {
      throw new BadRequestError("Enter a duration from 1 to 520 whole weeks.");
    }
    return duration;
  };

  const addWeeks = (db, blockId, first, last) => {
    for (let position = first; position <= last; position++) {
      save(db, "paideuo_program_weeks", { block: blockId, position, week_type: "normal" });
    }
  };

  const baselineOf = (slot) => JSON.parse(slot.getString("baseline") || "null");

  const copySlots = (db, sourceId, targetId, includeBaseline = false) =>
    new Map(
      slotsFor(db, sourceId).map((slot) => {
        const copy = save(db, "paideuo_session_slots", {
          ...copyFields(slot, ["weekday", "position", "label"]),
          ...(includeBaseline ? { baseline: baselineOf(slot) } : {}),
          block: targetId,
        });
        return [slot.id, copy.id];
      }),
    );

  const prescriptionFields = (record) =>
    copyFields(record, [
      "title",
      "description",
      "planned_duration_min",
      "duration_specified",
      "planned_intensity",
      "notes",
      "session_type",
    ]);

  const prescriptionComponents = (db, id) =>
    children(db, "paideuo_training_components", "prescription", id, "position,id");

  const componentFields = (component) => ({
    ...copyFields(component, [
      "position",
      "name",
      "instructions",
      "duration_min",
      "duration_specified",
    ]),
    targets: JSON.parse(component.getString("targets") || "null"),
  });

  const presentComponent = (component) => ({
    name: component.name,
    instructions: component.instructions,
    durationMin:
      component.duration_specified || component.duration_min > 0 ? component.duration_min : null,
    targets: component.targets,
  });

  const componentValues = require(__hooks + "/prescription-components.js");

  const copyPrescription = (db, fields, components, weekId, slotId) => {
    const prescription = save(db, "paideuo_session_prescriptions", {
      ...fields,
      program_week: weekId,
      slot: slotId,
    });
    for (const component of components) {
      save(db, "paideuo_training_components", { ...component, prescription: prescription.id });
    }
  };

  const sessionSummary = (record) => ({
    weekId: record.getString("program_week"),
    slotId: record.getString("slot"),
    title: record.getString("title"),
    plannedDurationMin:
      record.getBool("duration_specified") || record.getInt("planned_duration_min") > 0
        ? record.getInt("planned_duration_min")
        : null,
    plannedIntensity: record.getString("planned_intensity") || null,
  });

  const presentPrescription = (record, components) => ({
    ...sessionSummary(record),
    sessionType: record.getString("session_type"),
    description: record.getString("description"),
    notes: record.getString("notes"),
    components: components.map((component) => ({
      position: component.position,
      ...presentComponent(component),
    })),
  });

  const buildSchedule = (db, programId, blocks, startDate, projection = {}) => {
    const dates = require(__hooks + "/calendar-dates.js");
    const start = dates.parse(startDate);
    const components = new Map();
    for (const row of find(
      db,
      "paideuo_training_components",
      "prescription.program_week.block.program = {:programId}",
      { programId },
      "position,id",
    )) {
      const prescription = row.getString("prescription");
      if (!components.has(prescription)) components.set(prescription, []);
      components.get(prescription).push(presentComponent(componentFields(row)));
    }
    const prescriptions = new Map();
    for (const row of find(
      db,
      "paideuo_session_prescriptions",
      "program_week.block.program = {:programId}",
      { programId },
      "id",
    )) {
      const weekId = row.getString("program_week");
      if (!prescriptions.has(weekId)) prescriptions.set(weekId, []);
      prescriptions.get(weekId).push(row);
    }
    const sessions = [];
    let blockOffset = 0;
    for (const block of blocks) {
      const duration =
        projection.blockId === block.id ? projection.duration : block.getInt("duration_weeks");
      const slots = new Map(slotsFor(db, block.id).map((slot) => [slot.id, slot]));
      for (const week of children(db, "paideuo_program_weeks", "block", block.id, "position")) {
        if (week.getInt("position") > duration) continue;
        const weekOffset = blockOffset + (week.getInt("position") - 1) * 7;
        for (const row of prescriptions.get(week.id) || []) {
          if (row.getString("slot") === projection.removeSlot) continue;
          const slot = slots.get(row.getString("slot"));
          if (!slot)
            throw new BadRequestError("A prescription references a slot outside its block.");
          const day = new Date(start.getTime());
          day.setUTCDate(day.getUTCDate() + weekOffset + slot.getInt("weekday") - 1);
          const { title, plannedDurationMin, plannedIntensity } = sessionSummary(row);
          if (day.getUTCFullYear() > 9999) {
            throw new BadRequestError("This program extends beyond the supported calendar dates.");
          }
          sessions.push({
            sourcePrescriptionId: row.id,
            sourceAttribution: {
              blockId: block.id,
              blockName: block.getString("name"),
              weekId: week.id,
              weekPosition: week.getInt("position"),
              weekLabel: week.getString("label"),
            },
            scheduledDate: dates.format(day),
            slotPosition: slot.getInt("position"),
            prescription: {
              title,
              sessionType: row.getString("session_type"),
              description: row.getString("description"),
              notes: row.getString("notes"),
              plannedDurationMin,
              plannedIntensity,
              components: components.get(row.id) || [],
            },
          });
        }
      }
      blockOffset += duration * 7;
    }
    return sessions.sort(
      (a, b) =>
        a.scheduledDate.localeCompare(b.scheduledDate) ||
        a.slotPosition - b.slotPosition ||
        a.sourcePrescriptionId.localeCompare(b.sourcePrescriptionId),
    );
  };

  const sourceRevision = (sessions) => $security.sha256(JSON.stringify(sessions));

  const scheduledRows = (db, schedule, includeDeleted = false) =>
    find(
      db,
      "paideuo_scheduled_sessions",
      "schedule = {:schedule}" + (includeDeleted ? "" : " && deleted = false"),
      { schedule: schedule.id },
      "id",
    );

  const desiredSessions = (db, schedule, projection) =>
    buildSchedule(
      db,
      id,
      children(db, "paideuo_blocks", "program", id, "position,id"),
      schedule.getString("start_date"),
      projection,
    );

  const reviewSchedule = (db, schedule) => {
    const revisions = require(__hooks + "/schedule-revisions.js");
    return revisions.compare(
      scheduledRows(db, schedule, true),
      desiredSessions(db, schedule),
      revisions.todayFor(schedule),
    );
  };

  const createScheduledSession = (db, schedule, session) =>
    save(db, "paideuo_scheduled_sessions", {
      schedule: schedule.id,
      source_prescription_id: session.sourcePrescriptionId,
      source_attribution: session.sourceAttribution,
      scheduled_date: session.scheduledDate,
      original_date: session.scheduledDate,
      program_date: session.scheduledDate,
      slot_position: session.slotPosition,
      prescription_snapshot: session.prescription,
      status: "planned",
    });

  const weekDates = (db, schedule) => {
    const dates = require(__hooks + "/calendar-dates.js");
    const start = dates.parse(schedule.getString("start_date"));
    const result = new Map();
    let blockOffset = 0;
    for (const block of children(db, "paideuo_blocks", "program", id, "position,id")) {
      for (const week of children(db, "paideuo_program_weeks", "block", block.id, "position,id")) {
        const day = new Date(start.getTime());
        day.setUTCDate(day.getUTCDate() + blockOffset + (week.getInt("position") - 1) * 7);
        result.set(week.id, day);
      }
      blockOffset += block.getInt("duration_weeks") * 7;
    }
    return result;
  };

  const preserveStructure = (tx, change) => {
    const schedule = scheduleFor(tx, id);
    if (!schedule) return change();
    const revisions = require(__hooks + "/schedule-revisions.js");
    const today = revisions.todayFor(schedule);
    const cutoff = require(__hooks + "/calendar-dates.js").parse(today);
    const priorWeeks = weekDates(tx, schedule);
    const prior = new Map(
      desiredSessions(tx, schedule).map((session) => [
        session.sourcePrescriptionId,
        session.scheduledDate,
      ]),
    );
    change();
    const revisedWeeks = weekDates(tx, schedule);
    for (const [weekId, start] of priorWeeks) {
      if (start < cutoff && +revisedWeeks.get(weekId) !== +start) {
        throw new BadRequestError(
          "Training weeks that began before today cannot be moved or removed.",
        );
      }
    }
    for (const [weekId, start] of revisedWeeks) {
      if (start < cutoff && +priorWeeks.get(weekId) !== +start) {
        throw new BadRequestError("Training weeks cannot be added or moved into the past.");
      }
    }
    const next = new Map(
      desiredSessions(tx, schedule).map((session) => [
        session.sourcePrescriptionId,
        session.scheduledDate,
      ]),
    );
    for (const row of scheduledRows(tx, schedule)) {
      const source = row.getString("source_prescription_id");
      if (revisions.isProtected(row, today) && prior.get(source) !== next.get(source)) {
        throw new BadRequestError(
          "This change would remove or move the source of a protected calendar session.",
        );
      }
    }
  };

  const structureImpact = (db, projection) => {
    const schedule = scheduleFor(db, id);
    if (!schedule) return [];
    const prior = new Map(
      desiredSessions(db, schedule).map((session) => [session.sourcePrescriptionId, session]),
    );
    const next = new Map(
      desiredSessions(db, schedule, projection).map((session) => [
        session.sourcePrescriptionId,
        session,
      ]),
    );
    return scheduledRows(db, schedule).flatMap((row) => {
      const source = row.getString("source_prescription_id");
      const before = prior.get(source);
      const after = next.get(source);
      if (
        !before ||
        (after?.scheduledDate === before.scheduledDate &&
          after.slotPosition === before.slotPosition)
      )
        return [];
      return [
        {
          id: row.id,
          title: JSON.parse(row.getString("prescription_snapshot")).title,
          scheduledDate: row.getString("scheduled_date"),
          revisedProgramDate: after?.scheduledDate ?? null,
          status: row.getString("status"),
          manuallyMoved: row.getBool("manually_moved"),
        },
      ];
    });
  };

  const copyBlock = (tx, block, programId, position, name) => {
    const newBlock = save(tx, "paideuo_blocks", {
      ...copyFields(block, ["objective", "duration_weeks"]),
      name,
      position,
      program: programId,
    });
    const slots = copySlots(tx, block.id, newBlock.id, true);
    for (const week of children(tx, "paideuo_program_weeks", "block", block.id, "position")) {
      const newWeek = save(tx, "paideuo_program_weeks", {
        ...copyFields(week, ["position", "label", "focus", "week_type"]),
        block: newBlock.id,
      });
      for (const prescription of children(
        tx,
        "paideuo_session_prescriptions",
        "program_week",
        week.id,
      )) {
        const slot = slots.get(prescription.getString("slot"));
        if (!slot) throw new BadRequestError("A prescription references a slot outside its block.");
        copyPrescription(
          tx,
          prescriptionFields(prescription),
          prescriptionComponents(tx, prescription.id).map(componentFields),
          newWeek.id,
          slot,
        );
      }
    }
    return newBlock;
  };

  const slotData = (slot) => ({
    id: slot.id,
    label: slot.getString("label"),
    baselineName: baselineOf(slot)?.name ?? null,
    weekday: slot.getInt("weekday"),
    position: slot.getInt("position"),
  });

  const blockPrescriptions = (db, blockId) =>
    find(db, "paideuo_session_prescriptions", "program_week.block = {:blockId}", { blockId }, "id");

  const deletePrescriptions = (tx, records) => {
    for (const prescription of records) {
      for (const component of prescriptionComponents(tx, prescription.id)) tx.delete(component);
      tx.delete(prescription);
    }
  };

  const previewData = (weeks, prescriptions) => ({
    weekIds: weeks.map((week) => week.id),
    prescriptionIds: prescriptions.map((prescription) => prescription.id),
  });

  const confirmPreview = (weeks, prescriptions, impact) => {
    const expected = previewData(weeks, prescriptions);
    for (const key of ["weekIds", "prescriptionIds"]) {
      const supplied = body.confirmation && body.confirmation[key];
      if (
        !Array.isArray(supplied) ||
        supplied.length !== expected[key].length ||
        supplied.some((value, index) => value !== expected[key][index])
      ) {
        throw new BadRequestError("The affected records have changed. Review a fresh preview.");
      }
    }
    const suppliedImpact = body.confirmation?.scheduledSessions ?? [];
    if (
      !Array.isArray(suppliedImpact) ||
      suppliedImpact.length !== impact.length ||
      impact.some((session, index) =>
        Object.keys(session).some((key) => suppliedImpact[index]?.[key] !== session[key]),
      )
    ) {
      throw new BadRequestError("The affected calendar sessions changed. Review a fresh preview.");
    }
  };

  if (method === "GET" && id === "block-sources" && action === undefined) {
    const programs = find(app, "paideuo_programs", "owner = {:owner}", { owner }, "name,id");
    const byId = new Map(programs.map((program) => [program.id, program.getString("name")]));
    const blocks = find(app, "paideuo_blocks", "program.owner = {:owner}", { owner }, "name,id");
    return event.json(
      200,
      blocks.map((block) => ({
        id: block.id,
        name: block.getString("name"),
        programName: byId.get(block.getString("program")),
      })),
    );
  }

  const isCellRoute =
    blockAction === "weeks" &&
    slotAction === "cells" &&
    remaining[0] &&
    (remaining.length === 1 || (remaining.length === 2 && remaining[1] === "template"));
  if (id && action === "blocks" && blockId && (!remaining.length || isCellRoute)) {
    if (method === "GET" && blockAction === undefined) {
      const block = ownBlock(app, blockId, id);
      const weeks = children(app, "paideuo_program_weeks", "block", blockId, "position");
      return event.json(200, {
        ...blockData(block),
        scheduled: Boolean(scheduleFor(app, id)),
        weeks: weeks.map((week) => ({
          id: week.id,
          position: week.getInt("position"),
          label: week.getString("label"),
          focus: week.getString("focus"),
          weekType: week.getString("week_type"),
        })),
        slots: slotsFor(app, blockId).map(slotData),
        prescriptions: blockPrescriptions(app, blockId).map(sessionSummary),
      });
    }

    if (method === "GET" && blockAction === "compare-weeks" && slotId === undefined) {
      const query = event.request.url.query();
      const left = query.get("left");
      const right = query.get("right");
      if (!left || !right || left === right) {
        throw new BadRequestError("Choose two distinct weeks.");
      }
      let prescriptions;
      app.runInTransaction((tx) => {
        ownBlock(tx, blockId, id);
        const params = { blockId, left, right };
        const pair = "(id = {:left} || id = {:right})";
        const weeks = find(tx, "paideuo_program_weeks", `block = {:blockId} && ${pair}`, params);
        if (weeks.length !== 2) throw new NotFoundError("Week not found.");
        const records = find(
          tx,
          "paideuo_session_prescriptions",
          "program_week.block = {:blockId} && (program_week = {:left} || program_week = {:right})",
          params,
        );
        const components = new Map();
        for (const row of find(
          tx,
          "paideuo_training_components",
          "prescription.program_week.block = {:blockId} && (prescription.program_week = {:left} || prescription.program_week = {:right})",
          params,
          "position,id",
        )) {
          const key = row.getString("prescription");
          if (!components.has(key)) components.set(key, []);
          components.get(key).push(componentFields(row));
        }
        prescriptions = records.map((record) =>
          presentPrescription(record, components.get(record.id) ?? []),
        );
      });
      return event.json(200, prescriptions);
    }

    if (blockAction === "weeks" && slotId) {
      const weekId = slotId;
      const ownWeek = (db, requestedId) => {
        const [week] = find(
          db,
          "paideuo_program_weeks",
          "id = {:requestedId} && block = {:blockId}",
          {
            requestedId,
            blockId,
          },
        );
        if (!week) throw new NotFoundError("Week not found.");
        return week;
      };
      const requireSlot = (db, requestedId) => {
        const [slot] = find(
          db,
          "paideuo_session_slots",
          "id = {:requestedId} && block = {:blockId}",
          {
            requestedId,
            blockId,
          },
        );
        if (!slot) throw new NotFoundError("Slot not found.");
      };

      if (method === "PATCH" && slotAction === undefined) {
        if (!["normal", "recovery"].includes(body.weekType))
          throw new BadRequestError("Choose a week type.");
        app.runInTransaction((tx) => {
          ownBlock(tx, blockId, id);
          const week = ownWeek(tx, weekId);
          week.set("label", text("label", 10000));
          week.set("focus", text("focus", 10000));
          week.set("week_type", body.weekType);
          tx.save(week);
        });
        return event.json(200, { id: weekId });
      }

      const weekRecords = (db, requestedId) =>
        children(db, "paideuo_session_prescriptions", "program_week", requestedId, "id");
      const snapshot = (db, record) => ({
        id: record.id,
        slot: record.getString("slot"),
        fields: prescriptionFields(record),
        components: prescriptionComponents(db, record.id).map(componentFields),
      });
      const revision = (value) => $security.sha256(JSON.stringify(value));

      if (isCellRoute) {
        const cellSlot = remaining[0];
        const readCell = (db) => {
          ownBlock(db, blockId, id);
          ownWeek(db, weekId);
          requireSlot(db, cellSlot);
          return weekRecords(db, weekId).find((record) => record.getString("slot") === cellSlot);
        };

        const requireCurrent = (tx) => {
          const record = readCell(tx);
          if (body.revision !== revision(record ? snapshot(tx, record) : null)) {
            throw new BadRequestError("This session changed. Reopen it before saving.");
          }
          return record;
        };

        if (remaining[1] === "template") {
          if (method !== "POST") throw new NotFoundError();
          const name = text("name", 200, true);
          let templateId;
          app.runInTransaction((tx) => {
            const record = requireCurrent(tx);
            if (!record) throw new NotFoundError("Prescription not found.");
            const data = sessionSummary(record);
            const template = save(tx, "paideuo_session_templates", {
              owner,
              name,
              description: record.getString("description"),
              session_type: record.getString("session_type"),
              planned_duration_min: data.plannedDurationMin,
              planned_intensity: data.plannedIntensity ?? "",
              components: prescriptionComponents(tx, record.id)
                .map(componentFields)
                .map(presentComponent),
            });
            templateId = template.id;
          });
          return event.json(201, { id: templateId });
        }

        if (method === "DELETE") {
          app.runInTransaction((tx) => {
            const record = requireCurrent(tx);
            if (!record) throw new NotFoundError("Prescription not found.");
            deletePrescriptions(tx, [record]);
          });
          return event.json(200, { weekId, slotId: cellSlot });
        }

        if (method === "GET") {
          const record = readCell(app);
          if (!record) return event.json(200, { prescription: null, revision: revision(null) });
          const data = snapshot(app, record);
          return event.json(200, {
            revision: revision(data),
            prescription: presentPrescription(record, data.components),
          });
        }

        if (method === "PATCH") {
          const duration = body.plannedDurationMin;
          const intensity = body.plannedIntensity;
          if (duration !== null && (!Number.isSafeInteger(duration) || duration < 0)) {
            throw new BadRequestError(
              "Enter a nonnegative whole number of minutes or clear the duration.",
            );
          }
          if (intensity !== null && !["easy", "moderate", "hard", "maximal"].includes(intensity)) {
            throw new BadRequestError("Choose a planned intensity.");
          }
          if (
            !["climbing", "strength", "conditioning", "mobility", "other"].includes(
              body.sessionType,
            )
          ) {
            throw new BadRequestError("Choose a session type.");
          }
          const values = {
            title: text("title", 200, true),
            description: text("description", 10000),
            notes: text("notes", 10000),
            session_type: body.sessionType,
            planned_duration_min: duration ?? 0,
            duration_specified: duration !== null,
            planned_intensity: intensity ?? "",
          };
          const components =
            body.components === undefined ? undefined : componentValues(body.components);
          app.runInTransaction((tx) => {
            let record = requireCurrent(tx);
            if (record) {
              for (const [key, value] of Object.entries(values)) record.set(key, value);
              tx.save(record);
            } else {
              record = save(tx, "paideuo_session_prescriptions", {
                ...values,
                program_week: weekId,
                slot: cellSlot,
              });
            }
            if (components) {
              for (const component of prescriptionComponents(tx, record.id)) tx.delete(component);
              for (const component of components) {
                save(tx, "paideuo_training_components", { ...component, prescription: record.id });
              }
            }
          });
          return event.json(200, { weekId, slotId: cellSlot });
        }
      }

      if (method === "POST" && ["copy-preview", "copy"].includes(slotAction)) {
        const destinationId = text("destinationWeekId", 100, true);
        const chosenSlot = text("slotId", 100);
        const destinationSlot = text("destinationSlotId", 100) || chosenSlot;
        if (
          (!chosenSlot && body.destinationSlotId !== undefined) ||
          (destinationId === weekId && destinationSlot === chosenSlot)
        ) {
          throw new BadRequestError("Choose a different destination.");
        }
        const prepare = (db) => {
          ownBlock(db, blockId, id);
          ownWeek(db, weekId);
          ownWeek(db, destinationId);
          if (chosenSlot) {
            requireSlot(db, chosenSlot);
            if (destinationSlot !== chosenSlot) requireSlot(db, destinationSlot);
          }
          const matching = (requestedId, requestedSlot) =>
            weekRecords(db, requestedId).filter(
              (record) => !requestedSlot || record.getString("slot") === requestedSlot,
            );
          const source = matching(weekId, chosenSlot).map((record) => snapshot(db, record));
          if (chosenSlot && !source.length)
            throw new BadRequestError("The source cell has no prescription.");
          const destination = matching(destinationId, destinationSlot);
          const before = destination.map((record) => snapshot(db, record));
          const sourceSlots = new Set(source.map(({ slot }) => destinationSlot || slot));
          return {
            source,
            destination,
            preview: {
              revision: revision([
                weekId,
                destinationId,
                chosenSlot,
                destinationSlot,
                source,
                before,
              ]),
              copied: source.length,
              replaced: before.filter(({ slot }) => sourceSlots.has(slot)).length,
              removed: before.filter(({ slot }) => !sourceSlots.has(slot)).length,
            },
          };
        };
        if (slotAction === "copy-preview") {
          let preview;
          app.runInTransaction((tx) => {
            preview = prepare(tx).preview;
          });
          return event.json(200, preview);
        }
        let summary;
        app.runInTransaction((tx) => {
          const { source, destination, preview } = prepare(tx);
          if (body.revision !== preview.revision) {
            throw new BadRequestError(
              "The affected prescriptions changed. Review a fresh preview.",
            );
          }
          deletePrescriptions(tx, destination);
          for (const { slot, fields, components } of source) {
            copyPrescription(tx, fields, components, destinationId, destinationSlot || slot);
          }
          summary = preview;
        });
        return event.json(200, summary);
      }
      throw new NotFoundError();
    }

    if (method === "POST" && blockAction === "initialize-weeks" && slotId === undefined) {
      let created = 0;
      app.runInTransaction((tx) => {
        ownBlock(tx, blockId, id);
        const slots = slotsFor(tx, blockId)
          .map((slot) => ({ id: slot.id, baseline: baselineOf(slot) }))
          .filter(({ baseline }) => baseline !== null);
        const weeks = children(tx, "paideuo_program_weeks", "block", blockId, "position");
        const existing = new Set(
          blockPrescriptions(tx, blockId).map(
            (record) => `${record.getString("program_week")}/${record.getString("slot")}`,
          ),
        );
        for (const week of weeks) {
          for (const { id: slot, baseline } of slots) {
            if (existing.has(`${week.id}/${slot}`)) continue;
            const prescription = save(tx, "paideuo_session_prescriptions", {
              program_week: week.id,
              slot,
              title: baseline.name,
              description: baseline.description,
              session_type: baseline.sessionType,
              planned_duration_min: baseline.plannedDurationMin,
              duration_specified: baseline.plannedDurationMin != null,
              planned_intensity: baseline.plannedIntensity ?? "",
            });
            baseline.components.forEach((component, index) => {
              save(tx, "paideuo_training_components", {
                prescription: prescription.id,
                position: index + 1,
                name: component.name,
                instructions: component.instructions,
                duration_min: component.durationMin ?? 0,
                duration_specified: component.durationMin != null,
                targets: component.targets ?? null,
              });
            });
            created++;
          }
        }
      });
      return event.json(200, { created });
    }

    if (method === "PATCH" && blockAction === undefined) {
      app.runInTransaction((tx) => {
        const block = ownBlock(tx, blockId, id);
        block.set("name", text("name", 200, true));
        block.set("objective", text("objective", 10000));
        tx.save(block);
      });
      return event.json(200, { id: blockId });
    }

    if (
      method === "POST" &&
      slotId === undefined &&
      ["resize-preview", "resize"].includes(blockAction)
    ) {
      const duration = durationWeeks();
      const affected = (db) => {
        const weeks = find(
          db,
          "paideuo_program_weeks",
          "block = {:blockId} && position > {:duration}",
          { blockId, duration },
          "position",
        );
        const prescriptions = find(
          db,
          "paideuo_session_prescriptions",
          "program_week.block = {:blockId} && program_week.position > {:duration}",
          { blockId, duration },
          "id",
        );
        return { weeks, prescriptions };
      };
      const projection = { blockId, duration };
      if (blockAction === "resize-preview") {
        ownBlock(app, blockId, id);
        const { weeks, prescriptions } = affected(app);
        return event.json(200, {
          ...previewData(weeks, prescriptions),
          scheduledSessions: structureImpact(app, projection),
        });
      }
      app.runInTransaction((tx) => {
        const block = ownBlock(tx, blockId, id);
        const current = block.getInt("duration_weeks");
        const { weeks, prescriptions } = affected(tx);
        const impact = structureImpact(tx, projection);
        if (current > duration || body.confirmation !== undefined || impact.length) {
          confirmPreview(weeks, prescriptions, impact);
        }
        preserveStructure(tx, () => {
          deletePrescriptions(tx, prescriptions);
          weeks.forEach((week) => tx.delete(week));
          addWeeks(tx, blockId, current + 1, duration);
          block.set("duration_weeks", duration);
          tx.save(block);
        });
      });
      return event.json(200, { id: blockId });
    }

    if (method === "POST" && blockAction === "duplicate" && slotId === undefined) {
      const destinationId = text("destinationProgramId", 100, true);
      let copyId;
      app.runInTransaction((tx) => {
        const source = ownBlock(tx, blockId, id);
        const destination = ownProgram(tx, destinationId);
        if (destination.getString("status") !== "draft") {
          throw new BadRequestError("Choose a draft program.");
        }
        const name = Array.from(source.getString("name")).slice(0, 193).join("") + " (copy)";
        copyId = copyBlock(
          tx,
          source,
          destinationId,
          nextBlockPosition(tx, destinationId),
          name,
        ).id;
      });
      return event.json(201, { id: copyId, programId: destinationId });
    }

    if (blockAction !== "slots") throw new NotFoundError();

    const weekdayValue = () => {
      const weekday = body.weekday;
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
        throw new BadRequestError("Choose a day of the week.");
      }
      return weekday;
    };
    const ownSlot = (db) => {
      const [slot] = find(db, "paideuo_session_slots", "id = {:slotId} && block = {:blockId}", {
        slotId,
        blockId,
      });
      if (!slot) throw new NotFoundError("Slot not found.");
      return slot;
    };
    const daySlots = (db, weekday) =>
      find(
        db,
        "paideuo_session_slots",
        "block = {:blockId} && weekday = {:weekday}",
        { blockId, weekday },
        "position,id",
      );
    const nextSlotPosition = (db, weekday) => {
      const slots = daySlots(db, weekday);
      return slots.length ? slots[slots.length - 1].getInt("position") + 1 : 1;
    };
    const slotPrescriptions = (db) =>
      children(db, "paideuo_session_prescriptions", "slot", slotId, "id");

    if (method === "POST" && slotId === undefined) {
      const weekday = weekdayValue();
      const label = text("label", 200, true);
      let newSlotId;
      app.runInTransaction((tx) => {
        ownBlock(tx, blockId, id);
        newSlotId = save(tx, "paideuo_session_slots", {
          block: blockId,
          weekday,
          label,
          position: nextSlotPosition(tx, weekday),
        }).id;
      });
      return event.json(201, { id: newSlotId });
    }

    if (method === "PATCH" && slotId && slotAction === undefined) {
      const weekday = weekdayValue();
      const label = text("label", 200, true);
      app.runInTransaction((tx) => {
        ownBlock(tx, blockId, id);
        const slot = ownSlot(tx);
        const weekdayChanged = slot.getInt("weekday") !== weekday;
        const update = () => {
          if (weekdayChanged) {
            slot.set("position", nextSlotPosition(tx, weekday));
            slot.set("weekday", weekday);
          }
          slot.set("label", label);
          tx.save(slot);
        };
        if (weekdayChanged) preserveStructure(tx, update);
        else update();
      });
      return event.json(200, { id: slotId });
    }

    if (method === "PATCH" && slotId && slotAction === "baseline") {
      const templateId = body.templateId;
      if (templateId !== null && (typeof templateId !== "string" || !templateId)) {
        throw new BadRequestError("Choose a session template or clear the baseline.");
      }
      app.runInTransaction((tx) => {
        ownBlock(tx, blockId, id);
        const slot = ownSlot(tx);
        let baseline = null;
        if (templateId !== null) {
          const [template] = find(
            tx,
            "paideuo_session_templates",
            "id = {:templateId} && owner = {:owner}",
            { templateId, owner },
          );
          if (!template) throw new NotFoundError("Template not found.");
          baseline = {
            name: template.getString("name"),
            description: template.getString("description"),
            sessionType: template.getString("session_type"),
            plannedDurationMin: JSON.parse(template.getString("planned_duration_min") || "null"),
            plannedIntensity: template.getString("planned_intensity") || null,
            components: JSON.parse(template.getString("components") || "[]"),
          };
        }
        slot.set("baseline", baseline);
        tx.save(slot);
      });
      return event.json(200, { id: slotId });
    }

    if (method === "POST" && slotId && slotAction === "move") {
      if (body.offset !== -1 && body.offset !== 1) throw new BadRequestError("Choose a direction.");
      app.runInTransaction((tx) => {
        ownBlock(tx, blockId, id);
        const slot = ownSlot(tx);
        const slots = Array.from(daySlots(tx, slot.getInt("weekday")));
        const index = slots.findIndex((candidate) => candidate.id === slot.id);
        const destination = index + body.offset;
        if (destination < 0 || destination >= slots.length) {
          throw new BadRequestError("The slot cannot move farther in that direction.");
        }
        [slots[index], slots[destination]] = [slots[destination], slots[index]];
        slots.forEach((record, position) => {
          record.set("position", position + 1);
          tx.save(record);
        });
      });
      return event.json(200, { id: slotId });
    }

    if (method === "POST" && slotId && slotAction === "remove-preview") {
      ownBlock(app, blockId, id);
      ownSlot(app);
      return event.json(200, {
        ...previewData([], slotPrescriptions(app)),
        scheduledSessions: structureImpact(app, { removeSlot: slotId }),
      });
    }

    if (method === "POST" && slotId && slotAction === "remove") {
      app.runInTransaction((tx) => {
        ownBlock(tx, blockId, id);
        const slot = ownSlot(tx);
        const prescriptions = slotPrescriptions(tx);
        confirmPreview([], prescriptions, structureImpact(tx, { removeSlot: slotId }));
        preserveStructure(tx, () => {
          deletePrescriptions(tx, prescriptions);
          tx.delete(slot);
        });
      });
      return event.json(200, { id: slotId });
    }

    throw new NotFoundError();
  }

  if (method === "GET" && id && action === "training-load" && blockId === undefined) {
    const { rollup } = require(__hooks + "/training-load.js");
    const { completionCollection, completionData } = require(__hooks + "/calendar-sessions.js");
    let report;
    app.runInTransaction((tx) => {
      ownProgram(tx, id);
      const schedule = scheduleFor(tx, id);
      if (!schedule) throw new NotFoundError("Program schedule not found.");
      const completions = new Map(
        find(tx, completionCollection, "session.schedule = {:schedule}", {
          schedule: schedule.id,
        }).map((row) => [row.getString("session"), completionData(row)]),
      );
      const sessions = scheduledRows(tx, schedule).map((row) => {
        const snapshot = JSON.parse(row.getString("prescription_snapshot"));
        return {
          scheduledDate: row.getString("scheduled_date"),
          completed: row.getString("status") === "completed",
          plannedMinutes: snapshot.plannedDurationMin ?? null,
          sessionType: snapshot.sessionType,
          plannedIntensity: snapshot.plannedIntensity,
          completion: completions.get(row.id),
        };
      });
      const weekCount = children(tx, "paideuo_blocks", "program", id).reduce(
        (count, block) => count + block.getInt("duration_weeks"),
        0,
      );
      report = rollup(sessions, schedule.getString("start_date"), weekCount);
    });
    return event.json(200, report);
  }

  if (method === "GET" && id && action === "compliance" && blockId === undefined) {
    const { rollup } = require(__hooks + "/compliance.js");
    const { todayFor } = require(__hooks + "/schedule-revisions.js");
    const { completionCollection, completionData, statusFor } = require(
      __hooks + "/calendar-sessions.js",
    );
    let report;
    app.runInTransaction((tx) => {
      ownProgram(tx, id);
      const schedule = scheduleFor(tx, id);
      if (!schedule) throw new NotFoundError("Program schedule not found.");
      const measured = new Map(
        find(tx, completionCollection, "session.schedule = {:schedule}", {
          schedule: schedule.id,
        }).map((row) => [row.getString("session"), completionData(row).actualDurationMin]),
      );
      const today = todayFor(schedule);
      const sessions = scheduledRows(tx, schedule).map((row) => {
        const snapshot = JSON.parse(row.getString("prescription_snapshot"));
        return {
          source: JSON.parse(row.getString("source_attribution") || "null"),
          scheduledDate: row.getString("scheduled_date"),
          status: statusFor(row, today),
          planned: snapshot.plannedDurationMin ?? null,
          plannedIntensity: snapshot.plannedIntensity ?? null,
          actual: measured.get(row.id) ?? null,
        };
      });
      const weeksByBlock = new Map();
      for (const week of find(
        tx,
        "paideuo_program_weeks",
        "block.program = {:id}",
        { id },
        "position,id",
      )) {
        const blockId = week.getString("block");
        if (!weeksByBlock.has(blockId)) weeksByBlock.set(blockId, []);
        weeksByBlock.get(blockId).push({
          id: week.id,
          position: week.getInt("position"),
          label: week.getString("label"),
          historical: false,
        });
      }
      const blocks = children(tx, "paideuo_blocks", "program", id, "position,id").map((block) => ({
        id: block.id,
        name: block.getString("name"),
        weeks: weeksByBlock.get(block.id) ?? [],
      }));
      report = rollup(sessions, blocks, today);
    });
    return event.json(200, report);
  }

  if (method === "GET" && action === undefined) {
    if (!id) {
      const programs = find(app, "paideuo_programs", "owner = {:owner}", { owner }, "-updated,id");
      const blocks = find(app, "paideuo_blocks", "program.owner = {:owner}", { owner });
      const byProgram = new Map();
      for (const block of blocks) {
        const programId = block.getString("program");
        if (!byProgram.has(programId)) byProgram.set(programId, []);
        byProgram.get(programId).push(block);
      }
      const schedules = find(app, "paideuo_program_schedules", "program.owner = {:owner}", {
        owner,
      });
      const byScheduleProgram = new Map(
        schedules.map((schedule) => [schedule.getString("program"), schedule]),
      );
      return event.json(
        200,
        programs.map((program) =>
          programData(program, byProgram.get(program.id) || [], byScheduleProgram.get(program.id)),
        ),
      );
    }
    const program = ownProgram(app, id);
    const blocks = children(app, "paideuo_blocks", "program", id, "position");
    const schedule = scheduleFor(app, id);
    let pendingScheduleChanges = false;
    if (schedule) {
      try {
        pendingScheduleChanges = reviewSchedule(app, schedule).changes.some(
          (change) => !change.blockedReason,
        );
      } catch (error) {
        if (!(error instanceof BadRequestError)) throw error;
        pendingScheduleChanges = true;
      }
    }
    return event.json(200, {
      ...programData(program, blocks, schedule),
      blocks: blocks.map(blockData),
      schedule: schedule ? scheduleData(schedule) : null,
      pendingScheduleChanges,
    });
  }

  if (method === "POST" && !id && action === undefined) {
    const program = save(app, "paideuo_programs", { ...fields(), owner, status: "draft" });
    return event.json(201, { id: program.id });
  }

  if (
    method === "POST" &&
    id &&
    action === "schedule" &&
    blockId === "revisions" &&
    ["preview", "apply"].includes(blockAction) &&
    slotId === undefined
  ) {
    let response;
    app.runInTransaction((tx) => {
      ownProgram(tx, id);
      const schedule = scheduleFor(tx, id);
      if (!schedule) throw new NotFoundError("Program schedule not found.");
      if (blockAction === "preview") {
        response = reviewSchedule(tx, schedule);
        return;
      }
      const { operationId, revision, changeIds } = body;
      if (
        typeof operationId !== "string" ||
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(operationId) ||
        typeof revision !== "string" ||
        !Array.isArray(changeIds) ||
        !changeIds.length ||
        changeIds.some((key) => typeof key !== "string") ||
        new Set(changeIds).size !== changeIds.length
      ) {
        throw new BadRequestError("Select calendar changes to apply.");
      }
      const requestHash = sourceRevision([revision, [...changeIds].sort()]);
      const [receipt] = find(
        tx,
        "paideuo_schedule_revision_receipts",
        "schedule = {:schedule} && operation_id = {:operationId}",
        { schedule: schedule.id, operationId },
      );
      if (receipt) {
        if (receipt.getString("request_hash") !== requestHash) {
          throw new BadRequestError("This operation ID was already used for another selection.");
        }
        response = { applied: receipt.getInt("applied") };
        return;
      }
      const review = reviewSchedule(tx, schedule);
      if (revision !== review.revision) {
        throw new BadRequestError("The calendar changed. Review a fresh preview.");
      }
      const eligible = new Map(
        review.changes
          .filter((change) => !change.blockedReason)
          .map((change) => [change.id, change]),
      );
      if (changeIds.some((key) => !eligible.has(key))) {
        throw new BadRequestError("Some selected changes are unavailable. Review a fresh preview.");
      }
      const rows = new Map(
        scheduledRows(tx, schedule).map((row) => [row.getString("source_prescription_id"), row]),
      );
      for (const key of changeIds) {
        const change = eligible.get(key);
        if (change.kind === "add") {
          createScheduledSession(tx, schedule, change.after);
          continue;
        }
        const row = rows.get(key);
        if (change.kind === "remove") {
          tx.delete(row);
          continue;
        }
        if (change.kind === "keep-moved") {
          row.set("source_removal_acknowledged", true);
        } else {
          row.set("source_removal_acknowledged", false);
          row.set("program_date", change.programDate);
          row.set("scheduled_date", change.after.scheduledDate);
          row.set("slot_position", change.after.slotPosition);
          row.set("prescription_snapshot", change.after.prescription);
        }
        tx.save(row);
      }
      save(tx, "paideuo_schedule_revision_receipts", {
        schedule: schedule.id,
        operation_id: operationId,
        request_hash: requestHash,
        applied: changeIds.length,
      });
      response = { applied: changeIds.length };
    });
    return event.json(200, response);
  }

  if (
    method === "POST" &&
    id &&
    action === "schedule" &&
    (blockId === undefined || blockId === "preview") &&
    blockAction === undefined
  ) {
    const preview = blockId === "preview";
    let response;
    let status = 200;
    app.runInTransaction((tx) => {
      const program = ownProgram(tx, id);
      const existing = scheduleFor(tx, id);
      if (existing) {
        if (preview) throw new BadRequestError("This program already has a schedule.");
        response = scheduleData(existing);
        return;
      }
      const dates = require(__hooks + "/calendar-dates.js");
      const { startDate, timezone } = body;
      const date = dates.parse(startDate);
      if (!date || date.getUTCDay() !== 1) {
        throw new BadRequestError("Choose a valid Monday start date.");
      }
      if (!dates.validTimezone(timezone)) {
        throw new BadRequestError("Choose a valid IANA timezone.");
      }
      const blocks = children(tx, "paideuo_blocks", "program", id, "position");
      const sessions = buildSchedule(tx, id, blocks, startDate);
      if (!sessions.length) throw new BadRequestError("Add a prescription before scheduling.");
      const revision = sourceRevision(sessions);
      const confirmation = $security.sha256(JSON.stringify([startDate, timezone, revision]));
      if (preview) {
        response = { sessions, revision: confirmation };
        return;
      }
      if (body.revision !== confirmation) {
        throw new BadRequestError("The schedule preview changed. Review a fresh preview.");
      }
      const schedule = save(tx, "paideuo_program_schedules", {
        program: id,
        start_date: startDate,
        timezone,
        source_revision: revision,
        status: "active",
      });
      for (const session of sessions) createScheduledSession(tx, schedule, session);
      if (program.getString("status") === "draft") {
        program.set("status", "active");
        tx.save(program);
      }
      response = scheduleData(schedule);
      status = 201;
    });
    return event.json(status, response);
  }

  if (blockId !== undefined || !id) throw new NotFoundError();
  if (method === "PATCH" && action === undefined) {
    app.runInTransaction((tx) => {
      const program = ownProgram(tx, id);
      for (const [field, value] of Object.entries(fields())) program.set(field, value);
      tx.save(program);
    });
    return event.json(200, { id });
  }
  if (method !== "POST") throw new NotFoundError();

  if (action === "complete") {
    app.runInTransaction((tx) => {
      const program = ownProgram(tx, id);
      const schedule = scheduleFor(tx, id);
      const status = program.getString("status");
      if (!schedule || !["active", "completed"].includes(status)) {
        throw new BadRequestError("Only an active scheduled program can be marked complete.");
      }
      if (schedule.getString("status") !== "completed") {
        schedule.set("status", "completed");
        tx.save(schedule);
      }
      if (status !== "completed") {
        program.set("status", "completed");
        tx.save(program);
      }
    });
    return event.json(200, { id });
  }

  if (action === "archive") {
    app.runInTransaction((tx) => {
      const program = ownProgram(tx, id);
      program.set("status", "archived");
      tx.save(program);
    });
    return event.json(200, { id });
  }

  if (action === "blocks") {
    const name = text("name", 200, true);
    const objective = text("objective", 10000);
    const duration = durationWeeks();
    const sourceId = text("sourceBlockId", 100);
    let newBlockId;
    app.runInTransaction((tx) => {
      ownProgram(tx, id);
      if (sourceId) ownBlock(tx, sourceId);
      preserveStructure(tx, () => {
        const block = save(tx, "paideuo_blocks", {
          program: id,
          name,
          objective,
          position: nextBlockPosition(tx, id),
          duration_weeks: duration,
        });
        addWeeks(tx, block.id, 1, duration);
        if (sourceId) copySlots(tx, sourceId, block.id);
        newBlockId = block.id;
      });
    });
    return event.json(201, { id: newBlockId });
  }

  if (action === "reorder") {
    app.runInTransaction((tx) => {
      ownProgram(tx, id);
      const blocks = children(tx, "paideuo_blocks", "program", id, "position");
      const byId = new Map(blocks.map((block) => [block.id, block]));
      const ids = body.blockIds;
      if (
        !Array.isArray(ids) ||
        ids.length !== blocks.length ||
        new Set(ids).size !== ids.length ||
        ids.some((key) => !byId.has(key))
      ) {
        throw new BadRequestError("The order must include each current block exactly once.");
      }
      if (ids.every((key, index) => key === blocks[index].id)) return;
      preserveStructure(tx, () => {
        const highest = blocks[blocks.length - 1].getInt("position");
        blocks.forEach((block, index) => {
          block.set("position", highest + index + 1);
          tx.save(block);
        });
        ids.forEach((key, index) => {
          const block = byId.get(key);
          block.set("position", index + 1);
          tx.save(block);
        });
      });
    });
    return event.json(200, { id });
  }

  if (action !== "duplicate") throw new NotFoundError();
  const operationId = body.operationId;
  if (
    typeof operationId !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(operationId)
  ) {
    throw new BadRequestError("A valid duplication operation ID is required.");
  }
  let copyId;
  app.runInTransaction((tx) => {
    const source = ownProgram(tx, id);
    const [existing] = find(
      tx,
      "paideuo_program_duplications",
      "owner = {:owner} && operation_id = {:operationId}",
      { owner, operationId },
    );
    if (existing) {
      if (existing.getString("source") !== id) {
        throw new BadRequestError("This operation ID belongs to another program.");
      }
      copyId = existing.getString("copy");
      return;
    }
    const copy = save(tx, "paideuo_programs", {
      ...copyFields(source, ["description", "objective"]),
      name: Array.from(source.getString("name")).slice(0, 193).join("") + " (copy)",
      status: "draft",
      owner,
    });
    for (const block of children(tx, "paideuo_blocks", "program", id, "position")) {
      copyBlock(tx, block, copy.id, block.getInt("position"), block.getString("name"));
    }
    save(tx, "paideuo_program_duplications", {
      owner,
      source: id,
      copy: copy.id,
      operation_id: operationId,
    });
    copyId = copy.id;
  });
  return event.json(200, { id: copyId });
};

for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
  routerAdd(method, "/api/paideuo/programs", handlePrograms, $apis.requireAuth("paideuo_users"));
  routerAdd(
    method,
    "/api/paideuo/programs/{path...}",
    handlePrograms,
    $apis.requireAuth("paideuo_users"),
  );
}
