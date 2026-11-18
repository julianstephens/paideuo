import { Stack, Text } from "@chakra-ui/react";
import { fullDate } from "../calendar/dates";
import type { RemovalPreview } from "../programs/programs";

export const StructuralImpact = ({ sessions }: { sessions: RemovalPreview["scheduledSessions"] }) =>
  sessions.length ? (
    <Stack gap="2">
      <Text fontWeight="medium">Affected calendar sessions</Text>
      <Stack as="ul" ps="5" gap="1">
        {sessions.map((session) => (
          <Text as="li" key={session.id}>
            {session.title} · {fullDate(session.scheduledDate)} · {session.status}
            {session.manuallyMoved ? " · Manually moved" : ""}
            {session.revisedProgramDate
              ? ` · Revised program date ${fullDate(session.revisedProgramDate)}`
              : " · Source removed"}
          </Text>
        ))}
      </Stack>
      <Text>Saved program changes can be reviewed from the program’s schedule.</Text>
    </Stack>
  ) : null;
