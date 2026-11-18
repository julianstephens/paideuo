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
  const parse = (previous = []) => {
    const parseTargets = require(__hooks + "/component-targets.js");
    const body = event.requestInfo().body;
    if (!["climbing", "strength", "conditioning", "mobility", "other"].includes(body.sessionType)) {
      throw new BadRequestError("Choose a session type.");
    }
    if (!Array.isArray(body.components)) throw new BadRequestError("Enter a valid component list.");
    const intensity = body.plannedIntensity;
    if (intensity != null && !["easy", "moderate", "hard", "maximal"].includes(intensity)) {
      throw new BadRequestError("Choose a planned intensity.");
    }
    const seen = new Set();
    const components = body.components.map((component, index) => {
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
      const targets =
        component.targets === undefined
          ? previous[sourceIndex]?.targets
          : parseTargets(component.targets, index + 1);
      return {
        name: text(component.name, "component name", 200, true),
        instructions: text(component.instructions ?? "", "component instructions", 10000),
        durationMin: duration(component.durationMin),
        ...(targets !== undefined ? { targets } : {}),
      };
    });
    return {
      name: text(body.name, "name", 200, true),
      description: text(body.description ?? "", "description", 10000),
      session_type: body.sessionType,
      planned_duration_min: duration(body.plannedDurationMin),
      ...(intensity !== undefined ? { planned_intensity: intensity ?? "" } : {}),
      components,
    };
  };

  const present = (record) => {
    const data = fields(record);
    return {
      id: record.id,
      name: data.name,
      description: data.description,
      sessionType: data.session_type,
      plannedDurationMin: data.planned_duration_min,
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

  if (method === "POST" && !id) {
    const record = new Record(app.findCollectionByNameOrId(collection), { ...parse(), owner });
    app.save(record);
    return event.json(201, { id: record.id });
  }

  if (method === "PATCH" && action === undefined && id) {
    app.runInTransaction((tx) => {
      const record = ownTemplate(tx);
      if (event.requestInfo().body.updated !== record.getString("updated")) {
        throw new BadRequestError("This template changed. Cancel and reopen it before saving.");
      }
      for (const [key, value] of Object.entries(parse(readJSON(record, "components", "[]")))) {
        record.set(key, value);
      }
      tx.save(record);
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
    app.runInTransaction((tx) => tx.delete(ownTemplate(tx)));
    return event.json(200, { id });
  }
  throw new NotFoundError();
};

for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
  routerAdd(method, "/api/paideuo/templates", handleTemplates, $apis.requireAuth("paideuo_users"));
  routerAdd(
    method,
    "/api/paideuo/templates/{path...}",
    handleTemplates,
    $apis.requireAuth("paideuo_users"),
  );
}
