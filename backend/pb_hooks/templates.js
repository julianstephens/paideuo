const handleTemplates = (event) => {
  const path = event.request.pathValue("path");
  const [id, action, ...remaining] = path.split("/");
  if (remaining.length || (action !== undefined && !id)) throw new NotFoundError();
  const method = event.request.method;
  const owner = event.auth.id;
  const app = event.app;
  const collection = "paideuo_session_templates";

  const readJSON = (record, field, fallback) => JSON.parse(record.getString(field) || fallback);

  const fields = (record) => ({
    name: record.getString("name"),
    description: record.getString("description"),
    session_type: record.getString("session_type"),
    planned_duration_min: readJSON(record, "planned_duration_min", "null"),
    planned_duration_max: readJSON(record, "planned_duration_max", "null"),
    planned_rpe_min: readJSON(record, "planned_rpe_min", "null"),
    planned_rpe_max: readJSON(record, "planned_rpe_max", "null"),
    components: readJSON(record, "components", "[]"),
    planned_intensity: record.getString("planned_intensity"),
  });

  const ownTemplate = (db) => {
    const [record] = db.findRecordsByFilter(
      collection,
      "owner = {:owner} && id = {:id}",
      "",
      1,
      0,
      { owner, id },
    );
    if (!record) throw new NotFoundError("Template not found.");
    return record;
  };

  const text = (value, label, max, required = false) => {
    if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) {
      throw new BadRequestError(`Enter a valid ${label}.`);
    }
    return value.trim();
  };
  const duration = (value) => {
    if (value === undefined || value === null) return null;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new BadRequestError("Enter a nonnegative whole number of minutes.");
    }
    return value;
  };
  const parse = (body, previous = []) => {
    const componentValues = require(__hooks + "/prescription-components.js");
    const { presentComponent } = require(__hooks + "/prescription-fields.cjs");
    const { sessionTypes } = require(__hooks + "/training-prescription.cjs");
    if (!sessionTypes.includes(body.sessionType)) {
      throw new BadRequestError("Choose a session type.");
    }
    if (!Array.isArray(body.components)) throw new BadRequestError("Enter a valid component list.");
    const intensity = body.plannedIntensity;
    const durationMax = duration(body.plannedDurationMax);
    const rpeMin = body.plannedRpeMin ?? body.plannedRpe?.min ?? null;
    const rpeMax = body.plannedRpeMax ?? body.plannedRpe?.max ?? null;
    const parsedDuration = duration(body.plannedDurationMin);
    if (parsedDuration !== null && durationMax !== null && durationMax < parsedDuration)
      throw new BadRequestError(
        "Maximum duration must be greater than or equal to minimum duration.",
      );
    for (const rpe of [rpeMin, rpeMax]) {
      if (rpe !== null && (!Number.isFinite(rpe) || rpe < 1 || rpe > 10))
        throw new BadRequestError("Enter a session RPE from 1 to 10 or clear it.");
    }
    if (rpeMin !== null && rpeMax !== null && rpeMax < rpeMin)
      throw new BadRequestError("Maximum RPE must be greater than or equal to minimum RPE.");
    if (intensity != null && !["easy", "moderate", "hard", "maximal"].includes(intensity)) {
      throw new BadRequestError("Choose a planned intensity.");
    }
    const seen = new Set();
    const components = body.components.map((component) => {
      if (!component || typeof component !== "object" || Array.isArray(component)) {
        throw new BadRequestError("Enter a valid component.");
      }
      const { sourceIndex } = component;
      if (sourceIndex !== undefined) {
        if (!Number.isInteger(sourceIndex) || !previous[sourceIndex] || seen.has(sourceIndex)) {
          throw new BadRequestError("Reload the template before editing its components.");
        }
        seen.add(sourceIndex);
      }
      const prior = previous[sourceIndex];
      return {
        ...component,
        key: component.key ?? prior?.key,
        targets: component.targets === undefined ? prior?.targets : component.targets,
      };
    });
    return {
      name: text(body.name, "name", 200, true),
      description: text(body.description ?? "", "description", 10000),
      session_type: body.sessionType,
      planned_duration_min: duration(body.plannedDurationMin),
      planned_duration_max: durationMax,
      planned_rpe_min: rpeMin,
      planned_rpe_max: rpeMax,
      ...(intensity !== undefined ? { planned_intensity: intensity ?? "" } : {}),
      components: componentValues(components).map(presentComponent),
    };
  };

  const present = (record) => {
    const data = fields(record);
    return {
      id: record.id,
      externalId: record.getString("external_id") || null,
      name: data.name,
      description: data.description,
      sessionType: data.session_type,
      plannedDurationMin: data.planned_duration_min,
      plannedDurationMax: data.planned_duration_max,
      plannedRpeMin: data.planned_rpe_min,
      plannedRpeMax: data.planned_rpe_max,
      plannedIntensity: data.planned_intensity || null,
      components: data.components,
      updated: record.getString("updated"),
    };
  };

  if (method === "GET" && !id) {
    const records = app.findRecordsByFilter(collection, "owner = {:owner}", "name,id", 0, 0, {
      owner,
    });
    return event.json(200, records.map(present));
  }

  if (method === "GET" && id && action === undefined)
    return event.json(200, present(ownTemplate(app)));

  if (method === "POST" && !id) {
    const record = new Record(app.findCollectionByNameOrId(collection), {
      ...parse(event.requestInfo().body),
      owner,
    });
    app.save(record);
    return event.json(201, { id: record.id });
  }

  if (method === "PATCH" && action === undefined && id) {
    app.runInTransaction((tx) => {
      const record = ownTemplate(tx);
      const body = event.requestInfo().body;
      if (body.updated !== record.getString("updated")) {
        throw new BadRequestError("This template changed. Cancel and reopen it before saving.");
      }
      const previous = present(record);
      const next = { ...previous, ...body };
      if (body.plannedRpe !== undefined) {
        next.plannedRpeMin = body.plannedRpeMin ?? body.plannedRpe?.min ?? null;
        next.plannedRpeMax = body.plannedRpeMax ?? body.plannedRpe?.max ?? null;
      }
      for (const [key, value] of Object.entries(parse(next, previous.components))) {
        record.set(key, value);
      }
      tx.save(record);
      require(__hooks + "/template-links.js")(tx, record);
    });
    return event.json(200, { id });
  }

  if (method === "POST" && action === "duplicate") {
    let copyId;
    app.runInTransaction((tx) => {
      const source = fields(ownTemplate(tx));
      const name = Array.from(source.name).slice(0, 193).join("") + " (copy)";
      const record = new Record(tx.findCollectionByNameOrId(collection), {
        ...source,
        name,
        owner,
      });
      tx.save(record);
      copyId = record.id;
    });
    return event.json(201, { id: copyId });
  }

  if (method === "DELETE" && id && action === undefined) {
    app.runInTransaction((tx) => {
      const template = ownTemplate(tx);
      require(__hooks + "/template-links.js")(tx, template, true);
      tx.delete(template);
    });
    return event.json(200, { id });
  }
  throw new NotFoundError();
};

// oxlint-disable-next-line import/no-commonjs
module.exports = handleTemplates;
