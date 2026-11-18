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

  const programData = (program, blocks) => ({
    id: program.id,
    name: program.getString("name"),
    objective: program.getString("objective"),
    description: program.getString("description"),
    status: program.getString("status"),
    blockCount: blocks.length,
    weekCount: blocks.reduce((total, block) => total + block.getInt("duration_weeks"), 0),
    scheduled: false,
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

  const componentValues = (components) => {
    if (!Array.isArray(components)) throw new BadRequestError("Enter a valid component list.");
    const parseTargets = require(__hooks + "/component-targets.js");
    const whole = (value) => Number.isSafeInteger(value) && value >= 0;
    const nonempty = (value, max) =>
      typeof value === "string" && !!value.trim() && value.trim().length <= max;

    return components.map((component, index) => {
      const position = index + 1;
      if (
        !component ||
        typeof component !== "object" ||
        Array.isArray(component) ||
        !nonempty(component.name, 200)
      ) {
        throw new BadRequestError(`Enter a name for component ${position}.`);
      }
      const instructions = component.instructions ?? "";
      const duration = component.durationMin;
      if (typeof instructions !== "string" || instructions.trim().length > 10000) {
        throw new BadRequestError(`Enter valid instructions for component ${position}.`);
      }
      if (duration != null && !whole(duration)) {
        throw new BadRequestError(`Enter a nonnegative whole duration for component ${position}.`);
      }
      return {
        position,
        name: component.name.trim(),
        instructions: instructions.trim(),
        duration_min: duration ?? 0,
        duration_specified: duration != null,
        targets: parseTargets(component.targets, position),
      };
    });
  };

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

  const confirmPreview = (weeks, prescriptions) => {
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
            prescription: {
              ...sessionSummary(record),
              sessionType: record.getString("session_type"),
              description: record.getString("description"),
              notes: record.getString("notes"),
              components: data.components.map((component) => ({
                position: component.position,
                ...presentComponent(component),
              })),
            },
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
      if (blockAction === "resize-preview") {
        ownBlock(app, blockId, id);
        const { weeks, prescriptions } = affected(app);
        return event.json(200, previewData(weeks, prescriptions));
      }
      app.runInTransaction((tx) => {
        const block = ownBlock(tx, blockId, id);
        const current = block.getInt("duration_weeks");
        if (current > duration || body.confirmation !== undefined) {
          const { weeks, prescriptions } = affected(tx);
          confirmPreview(weeks, prescriptions);
          deletePrescriptions(tx, prescriptions);
          weeks.forEach((week) => tx.delete(week));
        }
        addWeeks(tx, blockId, current + 1, duration);
        block.set("duration_weeks", duration);
        tx.save(block);
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
        if (slot.getInt("weekday") !== weekday) {
          slot.set("position", nextSlotPosition(tx, weekday));
          slot.set("weekday", weekday);
        }
        slot.set("label", label);
        tx.save(slot);
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
      return event.json(200, previewData([], slotPrescriptions(app)));
    }

    if (method === "POST" && slotId && slotAction === "remove") {
      app.runInTransaction((tx) => {
        ownBlock(tx, blockId, id);
        const slot = ownSlot(tx);
        const prescriptions = slotPrescriptions(tx);
        confirmPreview([], prescriptions);
        deletePrescriptions(tx, prescriptions);
        tx.delete(slot);
      });
      return event.json(200, { id: slotId });
    }

    throw new NotFoundError();
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
      return event.json(
        200,
        programs.map((program) => programData(program, byProgram.get(program.id) || [])),
      );
    }
    const program = ownProgram(app, id);
    const blocks = children(app, "paideuo_blocks", "program", id, "position");
    return event.json(200, { ...programData(program, blocks), blocks: blocks.map(blockData) });
  }

  if (method === "POST" && !id && action === undefined) {
    const program = save(app, "paideuo_programs", { ...fields(), owner, status: "draft" });
    return event.json(201, { id: program.id });
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
