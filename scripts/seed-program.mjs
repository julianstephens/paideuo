import { isDeepStrictEqual } from "node:util";
import PocketBase, { ClientResponseError } from "pocketbase";

const program = {
  name: "Climbing Performance · 8-Week Project Cycle",
  objective: "Build repeatable climbing volume, then turn it into higher-quality project attempts.",
  description:
    "For an intermediate climber training three days a week. Keep the days between sessions free of hard climbing. Use familiar terrain and end a session early if movement quality drops or pain develops.",
};

const templates = [
  {
    name: "Project Cycle · Technique and Volume",
    description: "Use familiar climbs to practice precise movement at a sustainable effort.",
    sessionType: "climbing",
    plannedDurationMin: 70,
    components: [
      {
        name: "Progressive warm-up",
        instructions: "Start on easy terrain and build gradually.",
        durationMin: 15,
      },
      {
        name: "Technique mileage",
        instructions:
          "Alternate quiet feet and deliberate hip turns on submaximal climbs. Rest until breathing settles.",
        durationMin: 45,
      },
      {
        name: "Cool-down and log",
        instructions: "Climb easily and record which movement cues helped.",
        durationMin: 10,
      },
    ],
  },
  {
    name: "Project Cycle · Strength and Stability",
    description: "Build pulling strength and balance it with pushing and shoulder stability work.",
    sessionType: "strength",
    plannedDurationMin: 45,
    components: [
      {
        name: "Warm-up",
        instructions: "Use easy rows, shoulder circles and light presses.",
        durationMin: 10,
      },
      {
        name: "Pull and push",
        instructions: "Pair controlled rows with push-ups. Keep at least two reps in reserve.",
        durationMin: 25,
      },
      {
        name: "Shoulder and trunk stability",
        instructions: "Alternate light external rotations and side planks.",
        durationMin: 10,
      },
    ],
  },
  {
    name: "Project Cycle · Project Practice",
    description: "Rehearse hard sequences with long rests and track the quality of each attempt.",
    sessionType: "climbing",
    plannedDurationMin: 90,
    components: [
      {
        name: "Progressive warm-up",
        instructions: "Build from easy movement to a few moderately hard moves.",
        durationMin: 25,
      },
      {
        name: "Project attempts",
        instructions:
          "Rest 3–5 minutes between hard efforts and stop when contact or footwork starts to fade.",
        durationMin: 55,
      },
      {
        name: "Cool-down and log",
        instructions: "Climb easily and write down one cue to try next time.",
        durationMin: 10,
      },
    ],
  },
];

const slots = [
  { weekday: 2, label: "Technique and volume" },
  { weekday: 4, label: "Strength and stability" },
  { weekday: 6, label: "Project practice" },
];

const blocks = [
  {
    name: "Movement and Work Capacity",
    objective: "Establish a repeatable training rhythm and improve movement efficiency.",
    weeks: [
      [
        "Set a baseline",
        "Record a comfortable training load.",
        [
          "6 easy climbs, emphasizing quiet feet.",
          "2 sets of 8 per movement.",
          "Try 3 familiar problems and note the hardest move on each.",
        ],
      ],
      [
        "Build volume",
        "Add work while keeping the same effort.",
        [
          "8 easy climbs, emphasizing hip position.",
          "3 sets of 8 per movement.",
          "Rehearse 2 cruxes with 3 attempts each.",
        ],
      ],
      [
        "Consolidate",
        "Repeat the workload with cleaner execution.",
        [
          "8 easy climbs, repeating any with sloppy footwork.",
          "3 sets of 8 with controlled lowering.",
          "Try to link the crux into the next two moves.",
        ],
      ],
      [
        "Deload",
        "Reduce work and finish each session feeling fresh.",
        [
          "4 easy climbs with generous rests.",
          "1–2 light sets of 6 per movement.",
          "Climb familiar easy problems and skip hard attempts.",
        ],
      ],
    ],
  },
  {
    name: "Project Specificity and Performance",
    objective: "Practice the target sequences, then reduce volume for a fresh performance attempt.",
    weeks: [
      [
        "Choose a project",
        "Pick a challenging climb and map its sequences.",
        [
          "6 easy climbs that share the project angle or holds.",
          "2 sets of 8 per movement.",
          "Identify a sequence for each crux and rehearse it in isolation.",
        ],
      ],
      [
        "Link sections",
        "Practice getting into and out of the crux.",
        [
          "6 easy climbs with deliberate pacing.",
          "2 sets of 6 per movement.",
          "Make up to 5 high-quality linking attempts.",
        ],
      ],
      [
        "Rehearse full attempts",
        "Dial in pacing, rests and sequence cues.",
        [
          "5 easy climbs and two movement drills.",
          "2 sets of 6 per movement.",
          "Make up to 4 full attempts with long rests.",
        ],
      ],
      [
        "Taper and try",
        "Arrive fresh for the final project session.",
        [
          "3 easy climbs and a short cool-down.",
          "1 light set of 6 per movement.",
          "After warming up, take 2–3 well-rested project attempts.",
        ],
      ],
    ],
  },
];

const hybridTemplateName = "Project Cycle · Technique and Conditioning";

const rpe = (value) => ({ value, scale: "RPE" });

const hybridComponents = (index, template, recovery, easy) => {
  const [warmUp, main, finish] = template.components;
  if (index === 0) {
    return [
      warmUp,
      {
        ...main,
        durationMin: recovery ? 25 : 35,
        targets: {
          grade: { min: "V0", max: recovery ? "V1" : "V3" },
          angle_degrees: 10,
          intensity: rpe(recovery ? 4 : 6),
        },
      },
      {
        name: "Dumbbell rows",
        instructions:
          "Use a load you can control without rotating. Adjust the example load to leave three reps in reserve.",
        durationMin: 5,
        targets: {
          sets: recovery ? 1 : 2,
          reps: "8 per side",
          load: { value: recovery ? 6 : 10, unit: "kg" },
        },
      },
      {
        name: "Easy bike intervals",
        instructions: "Pedal easily between steady efforts. Keep the pace conversational.",
        durationMin: 10,
        targets: { sets: recovery ? 3 : 5, work_seconds: 60, rest_seconds: 60 },
      },
      { name: finish.name, instructions: finish.instructions, durationMin: null },
    ];
  }
  if (index === 1) {
    return [
      warmUp,
      {
        ...main,
        durationMin: recovery ? 15 : 25,
        targets: { intensity: rpe(recovery ? 4 : 7), rest_seconds: 90 },
      },
      finish,
    ];
  }
  return [
    warmUp,
    easy
      ? {
          name: "Easy movement mileage",
          instructions: "Stay on familiar climbs and stop before fatigue changes your movement.",
          durationMin: 20,
          targets: { grade: { max: "V2" }, intensity: rpe(4) },
        }
      : {
          ...main,
          durationMin: recovery ? 35 : 55,
          targets: { intensity: rpe(8), rest_seconds: 240 },
        },
    finish,
  ];
};

const componentFields = (components) =>
  components.map(({ name, instructions, durationMin, targets }) => ({
    name,
    instructions,
    durationMin,
    targets: targets ?? null,
  }));

const templateDefaults = (template, index) => {
  const [, main] = hybridComponents(index, template, false, false);
  return {
    ...template,
    plannedIntensity: index === 2 ? "hard" : "moderate",
    components: template.components.map((component, position) =>
      position === 1 ? { ...component, targets: main.targets } : component,
    ),
  };
};

const matchesTemplate = (record, template) =>
  record.description === template.description &&
  record.sessionType === template.sessionType &&
  record.plannedDurationMin === template.plannedDurationMin &&
  record.plannedIntensity === (template.plannedIntensity ?? null) &&
  isDeepStrictEqual(componentFields(record.components), componentFields(template.components));

const seed = async () => {
  const { TEST_EMAIL, TEST_PASSWORD, POCKETBASE_URL = "http://127.0.0.1:8090" } = process.env;
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error("Set TEST_EMAIL and TEST_PASSWORD for an existing paideuo_users account.");
  }

  const pb = new PocketBase(POCKETBASE_URL);
  await pb.collection("paideuo_users").authWithPassword(TEST_EMAIL, TEST_PASSWORD);

  const programsPath = "/api/paideuo/programs";
  const templatesPath = "/api/paideuo/templates";
  const post = (path, body) => pb.send(path, { method: "POST", body });
  const patch = (path, body) => pb.send(path, { method: "PATCH", body });

  const programs = await pb.send(programsPath);
  const seeded =
    programs.find(({ name }) => name === program.name) ?? (await post(programsPath, program));
  const programPath = `${programsPath}/${seeded.id}`;
  const currentProgram = await pb.send(programPath);

  const library = await pb.send(templatesPath);
  let hybridTemplate = library.find(({ name }) => name === hybridTemplateName);
  const defaults = templates.map(templateDefaults);
  const baselines = [];
  for (const [index, fields] of defaults.entries()) {
    const existing = library.find(({ name }) => name === fields.name);
    if (!existing) {
      baselines.push(await post(templatesPath, fields));
      continue;
    }
    if (matchesTemplate(existing, templates[index])) {
      await patch(`${templatesPath}/${existing.id}`, { ...fields, updated: existing.updated });
    }
    baselines.push(existing);
  }

  for (const { name, objective, weeks } of blocks) {
    const block =
      currentProgram.blocks.find((item) => item.name === name) ??
      (await post(`${programPath}/blocks`, { name, objective, durationWeeks: weeks.length }));
    const blockPath = `${programPath}/blocks/${block.id}`;
    const detail = await pb.send(blockPath);
    const plannedSlots = [];
    for (const [index, fields] of slots.entries()) {
      const slot =
        detail.slots.find(
          (item) => item.weekday === fields.weekday && item.label === fields.label,
        ) ?? (await post(`${blockPath}/slots`, fields));
      if (!slot.baselineName) {
        await patch(`${blockPath}/slots/${slot.id}/baseline`, { templateId: baselines[index].id });
      }
      plannedSlots.push({ id: slot.id, label: fields.label });
    }
    await post(`${blockPath}/initialize-weeks`);

    for (const week of detail.weeks) {
      const plan = weeks[week.position - 1];
      if (!plan) continue;
      const [label, focus, notes] = plan;
      const recovery = week.position === weeks.length;
      const weekPath = `${blockPath}/weeks/${week.id}`;
      if (!week.label && !week.focus && week.weekType === "normal") {
        await patch(weekPath, { label, focus, weekType: recovery ? "recovery" : "normal" });
      }

      for (const [index, slot] of plannedSlots.entries()) {
        const cellPath = `${weekPath}/cells/${slot.id}`;
        const { prescription, revision } = await pb.send(cellPath);
        const template = templates[index];
        const easy = recovery && (index !== 2 || name === blocks[0].name);
        const plannedIntensity = easy ? "easy" : index === 2 ? "hard" : "moderate";
        const seededCell =
          prescription &&
          ((prescription.title === template.name &&
            !prescription.notes &&
            (matchesTemplate(prescription, template) ||
              matchesTemplate(prescription, defaults[index]))) ||
            (prescription.title === slot.label &&
              prescription.notes === notes[index] &&
              matchesTemplate(prescription, { ...template, plannedIntensity })));

        const source =
          index === 0 && name === blocks[1].name && !recovery && hybridTemplate
            ? hybridTemplate
            : template;
        const insertTemplate = source === hybridTemplate;
        const components = insertTemplate
          ? componentFields(source.components)
          : hybridComponents(index, source, recovery, easy);
        const fields = {
          title: slot.label,
          description: source.description,
          sessionType: source.sessionType,
          plannedDurationMin: insertTemplate
            ? source.plannedDurationMin
            : components.reduce((total, component) => total + (component.durationMin ?? 0), 0),
          plannedIntensity: insertTemplate ? source.plannedIntensity : plannedIntensity,
          notes: notes[index],
        };

        if (seededCell) {
          await patch(cellPath, { ...fields, revision, components });
        }

        if (!hybridTemplate && index === 0 && name === blocks[0].name && week.position === 1) {
          const current = seededCell ? await pb.send(cellPath) : { prescription, revision };
          if (
            current.prescription &&
            Object.entries(fields).every(([key, value]) => current.prescription[key] === value) &&
            isDeepStrictEqual(
              componentFields(current.prescription.components),
              componentFields(components),
            )
          ) {
            const { id } = await post(`${cellPath}/template`, {
              name: hybridTemplateName,
              revision: current.revision,
            });
            hybridTemplate = (await pb.send(templatesPath)).find((entry) => entry.id === id);
          }
        }
      }
    }
  }

  console.log(`Seeded "${program.name}". Open /programs/${seeded.id} in the app.`);
};

try {
  await seed();
} catch (error) {
  // PocketBase errors can include request details. Print only the API message or status.
  const detail =
    error instanceof ClientResponseError
      ? error.response.message ||
        (error.status ? `HTTP ${error.status}` : "Could not reach PocketBase.")
      : error.message;
  console.error(`Program seed failed: ${detail}`);
  process.exitCode = 1;
}
