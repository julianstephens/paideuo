import { McpConsentPage } from "../features/auth/McpConsentPage";
import { RequireSession, SignInPage } from "../features/auth/AuthRoutes";
import { BlockPage } from "../features/blocks/BlockPage";
import { ProgramPage } from "../features/programs/ProgramPage";
import { Link, Stack } from "@chakra-ui/react";
import { Link as RouterLink, Outlet, createBrowserRouter } from "react-router";
import { RouteErrorBoundary } from "./AppErrorBoundary";
import { AnnualPlanPage } from "../features/annual-plan/AnnualPlanPage";
import { CalendarPage } from "../features/calendar/CalendarPage";
import { MetricsPage } from "../features/compliance/MetricsPage";
import { WeeklyReviewPage } from "../features/reviews/WeeklyReviewPage";
import { ProgramsPage } from "../features/programs/ProgramsPage";
import { LibraryPage } from "../features/templates/LibraryPage";
import { PageHeader, Panel } from "../components/ui";
import { AppLayout } from "./AppLayout";
import { ImportsPage } from "../features/imports/ImportsPage";
import { SettingsPage } from "../features/settings/SettingsPage";

export const router = createBrowserRouter([
  {
    Component: Outlet,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      { path: "sign-in", Component: SignInPage },
      {
        Component: RequireSession,
        children: [
          { path: "mcp/authorize", Component: McpConsentPage },
          {
            Component: AppLayout,
            children: [
              { index: true, Component: CalendarPage },
              { path: "annual-plan", Component: AnnualPlanPage },
              { path: "metrics", Component: MetricsPage },
              { path: "programs", Component: ProgramsPage },
              { path: "programs/:programId", Component: ProgramPage },
              { path: "programs/:programId/weekly-reviews/:weekId", Component: WeeklyReviewPage },
              { path: "programs/:programId/blocks/:blockId", Component: BlockPage },
              { path: "library", Component: LibraryPage },
              { path: "imports", Component: ImportsPage },
              { path: "settings", Component: SettingsPage },
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
    ],
  },
]);
