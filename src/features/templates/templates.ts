import type { PrescriptionComponent } from "../prescriptions/components";
import type { PlannedIntensity } from "../programs/programs";
import { apiRequest } from "../../lib/api/request";

export const sessionTypes = [
  "climbing",
  "strength",
  "conditioning",
  "mobility",
  "other",
  "rest",
] as const;
export type SessionType = (typeof sessionTypes)[number];

export type TemplateFields = {
  name: string;
  description: string;
  sessionType: SessionType;
  plannedDurationMin: number | null;
  plannedDurationMax?: number | null;
  plannedRpeMin?: number | null;
  plannedRpeMax?: number | null;
  plannedIntensity: PlannedIntensity | null;
  components: PrescriptionComponent[];
};

export type SessionTemplate = TemplateFields & {
  id: string;
  updated: string;
};
const endpoint = "/api/paideuo/templates";
const templatePath = (id: string) => `${endpoint}/${encodeURIComponent(id)}`;

export const templateKey = (ownerId: string) => ["templates", ownerId] as const;

export const templatesApi = {
  list: (signal: AbortSignal) => apiRequest<SessionTemplate[]>(endpoint, "GET", undefined, signal),
  create: (fields: TemplateFields) => apiRequest(endpoint, "POST", fields),
  update: (template: SessionTemplate, fields: TemplateFields) =>
    apiRequest(templatePath(template.id), "PATCH", { ...fields, updated: template.updated }),
  duplicate: (id: string) => apiRequest(`${templatePath(id)}/duplicate`, "POST"),
  remove: (id: string) => apiRequest(templatePath(id), "DELETE"),
};
