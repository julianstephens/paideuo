import { RequireSession, SignInPage } from "../features/auth/AuthRoutes";
import { BlockPage } from "../features/blocks/BlockPage";
import { ProgramPage } from "../features/programs/ProgramPage";
import { Link, Stack } from "@chakra-ui/react";
import { Link as RouterLink, createBrowserRouter } from "react-router";
import { CalendarPage } from "../features/calendar/CalendarPage";
import { MetricsPage } from "../features/compliance/MetricsPage";
import { WeeklyReviewPage } from "../features/reviews/WeeklyReviewPage";
import { ProgramsPage } from "../features/programs/ProgramsPage";
import { LibraryPage } from "../features/templates/LibraryPage";
import { PageHeader, Panel } from "../components/ui";
import { AppLayout } from "./AppLayout";

export const router = createBrowserRouter([
  { path: "sign-in", Component: SignInPage },
  {
    Component: RequireSession,
    children: [
      {
        Component: AppLayout,
        children: [
          { index: true, Component: CalendarPage },
          { path: "metrics", Component: MetricsPage },
          { path: "programs", Component: ProgramsPage },
          { path: "programs/:programId", Component: ProgramPage },
          { path: "programs/:programId/weekly-reviews/:weekId", Component: WeeklyReviewPage },
          { path: "programs/:programId/blocks/:blockId", Component: BlockPage },
          { path: "library", Component: LibraryPage },
          {
            path: "*",
            element: (
              <Stack gap="5">
                <PageHeader title="Page not found" />
                <Panel align="start">
                  <Link asChild variant="underline">
                    <RouterLink to="/">Back to Calendar</RouterLink>
                  </Link>
                </Panel>
              </Stack>
            ),
          },
        ],
      },
    ],
  },
]);
