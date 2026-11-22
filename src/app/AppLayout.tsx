import { Button, Link, Popover, Portal, Stack, Tooltip } from "@chakra-ui/react";
import { useLayoutEffect, useRef, useState } from "react";
import { Link as RouterLink, NavLink, Outlet, useLocation } from "react-router";

import { signOut } from "../lib/api/pocketbase";
import { AppIcon, Wordmark } from "./AppIcon";
import { ColorModeControl } from "./ColorModeControl";

const navigation = [
  { to: "/", label: "Calendar", icon: "calendar" },
  { to: "/annual-plan", label: "Annual Plan", icon: "plan" },
  { to: "/programs", label: "Programs", icon: "programs" },
  { to: "/metrics", label: "Metrics", icon: "metrics" },
  { to: "/library", label: "Library", icon: "library" },
  { to: "/imports", label: "Imports", icon: "imports" },
] as const;

const workspaces = {
  train: { label: "Train", to: "/" },
  plan: { label: "Plan", to: "/programs" },
} as const;
const planRoutes = ["/annual-plan", "/programs", "/library", "/imports"];
const workspaceKey = "paideuo-workspace";

const sidebarKey = "paideuo-sidebar-collapsed";

const readSidebarPreference = () => {
  try {
    return localStorage.getItem(sidebarKey) === "true";
  } catch {
    return false;
  }
};

const NavigationLink = ({
  to,
  label,
  icon,
  collapsed,
}: (typeof navigation)[number] & { collapsed: boolean }) => {
  const link = (
    <NavLink className="app-nav-link" to={to} end={to === "/"} aria-label={label}>
      <AppIcon name={icon} />
      <span className="app-nav-label">{label}</span>
    </NavLink>
  );

  return collapsed ? (
    <Tooltip.Root positioning={{ placement: "right" }} openDelay={200}>
      <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
      <Portal>
        <Tooltip.Positioner>
          <Tooltip.Content hideBelow="lg">{label}</Tooltip.Content>
        </Tooltip.Positioner>
      </Portal>
    </Tooltip.Root>
  ) : (
    link
  );
};

export const AppLayout = () => {
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const routedWorkspace =
    pathname === "/"
      ? "train"
      : planRoutes.some((route) => pathname === route || pathname.startsWith(route + "/"))
        ? "plan"
        : undefined;
  const [lastWorkspace, setLastWorkspace] = useState<keyof typeof workspaces>(() => {
    try {
      return sessionStorage.getItem(workspaceKey) === "plan" ? "plan" : "train";
    } catch {
      return "train";
    }
  });
  if (routedWorkspace && routedWorkspace !== lastWorkspace) setLastWorkspace(routedWorkspace);
  const workspace = routedWorkspace ?? lastWorkspace;
  const primary =
    workspace === "train"
      ? navigation.filter(({ to }) => to === "/" || to === "/metrics")
      : navigation.filter(({ to }, index) => index < 4 && to !== "/");
  const secondary = workspace === "plan" ? navigation.slice(4) : [];

  useLayoutEffect(() => {
    if (!routedWorkspace) return;
    try {
      sessionStorage.setItem(workspaceKey, routedWorkspace);
    } catch {
      // The workspace is still tracked while the app is open.
    }
  }, [routedWorkspace]);
  const [collapsed, setCollapsed] = useState(readSidebarPreference);
  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(sidebarKey, String(next));
    } catch {
      // The preference still applies for this visit.
    }
  };

  useLayoutEffect(() => {
    main.current?.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app-shell" data-sidebar-collapsed={collapsed || undefined}>
      <Link
        href="#main-content"
        position="absolute"
        zIndex="skipLink"
        insetInlineStart="3"
        top="3"
        bg="bg.panel"
        p="3"
        borderRadius="md"
        clipPath="inset(50%)"
        _focusVisible={{ clipPath: "none" }}
      >
        Skip to main content
      </Link>
      <header className="app-header">
        <NavLink to={workspaces[workspace].to} className="app-home">
          <Wordmark />
        </NavLink>
        <nav className="app-workspaces" aria-label="Workspace">
          {Object.entries(workspaces).map(([key, { label, to }]) => (
            <RouterLink key={key} to={to} aria-current={workspace === key ? "true" : undefined}>
              {label}
            </RouterLink>
          ))}
        </nav>
        <Popover.Root positioning={{ placement: "bottom-end" }}>
          <Popover.Trigger asChild>
            <Button variant="outline" size="sm" aria-label="Account">
              <AppIcon name="account" size={17} />
              <span className="app-account-label">Account</span>
            </Button>
          </Popover.Trigger>
          <Portal>
            <Popover.Positioner>
              <Popover.Content w="14rem" aria-label="Account settings">
                <Popover.Body>
                  <Stack gap="3">
                    <ColorModeControl />
                    <Popover.CloseTrigger asChild>
                      <Button asChild variant="outline">
                        <NavLink to="/settings">Settings</NavLink>
                      </Button>
                    </Popover.CloseTrigger>
                    <Button variant="outline" onClick={signOut}>
                      Sign out
                    </Button>
                  </Stack>
                </Popover.Body>
              </Popover.Content>
            </Popover.Positioner>
          </Portal>
        </Popover.Root>
      </header>
      <nav id="primary-navigation" aria-label="Primary" className="app-nav">
        <button
          type="button"
          className="app-nav-link app-sidebar-toggle"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          aria-controls="primary-navigation"
          title={collapsed ? "Expand sidebar" : undefined}
          onClick={toggleSidebar}
        >
          <AppIcon name={collapsed ? "expandSidebar" : "collapseSidebar"} />
          <span className="app-nav-label">Collapse sidebar</span>
        </button>
        {primary.map((item) => (
          <NavigationLink key={item.to} {...item} collapsed={collapsed} />
        ))}
        {secondary.length > 0 && (
          <>
            <div className="app-nav-secondary">
              {secondary.map((item) => (
                <NavigationLink key={item.to} {...item} collapsed={collapsed} />
              ))}
            </div>
            <Popover.Root positioning={{ placement: "top-end" }} closeOnInteractOutside>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className="app-nav-link app-nav-more"
                  data-current={secondary.some(({ to }) => pathname === to) || undefined}
                >
                  <AppIcon name="more" />
                  <span>More</span>
                </button>
              </Popover.Trigger>
              <Portal>
                <Popover.Positioner>
                  <Popover.Content w="11rem" aria-label="More navigation">
                    <Popover.Body>
                      <Stack gap="1">
                        {secondary.map((item) => (
                          <Popover.CloseTrigger key={item.to} asChild>
                            <NavLink className="app-nav-link" to={item.to}>
                              <AppIcon name={item.icon} />
                              {item.label}
                            </NavLink>
                          </Popover.CloseTrigger>
                        ))}
                      </Stack>
                    </Popover.Body>
                  </Popover.Content>
                </Popover.Positioner>
              </Portal>
            </Popover.Root>
          </>
        )}
      </nav>
      <main ref={main} id="main-content" tabIndex={-1} className="app-content">
        <div className="app-page">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
