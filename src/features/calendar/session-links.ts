export const sessionCalendarUrl = (date: string, sessionId: string) =>
  `/?${new URLSearchParams({ view: "week", date, session: sessionId })}`;

export const selectedCalendarSession = <Session extends { id: string }>(
  sessions: Session[] | undefined,
  params: URLSearchParams,
) => {
  const id = params.get("session");
  return sessions?.find((session) => session.id === id);
};
