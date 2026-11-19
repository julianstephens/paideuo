import { Box, Button, Flex, Grid, Link, Popover, Portal, Stack, Text } from "@chakra-ui/react";
import { useLayoutEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router";

import { signOut } from "../lib/api/pocketbase";
import { ColorModeControl } from "./ColorModeControl";

const navigation = [
  { to: "/", label: "Calendar" },
  { to: "/annual-plan", label: "Annual Plan" },
  { to: "/programs", label: "Programs" },
  { to: "/metrics", label: "Metrics" },
  { to: "/library", label: "Library" },
];

const Navigation = ({ placement }: { placement: "sidebar" | "header" | "bottom" }) => (
  <Flex
    as="nav"
    aria-label="Primary"
    className={placement === "bottom" ? "app-mobile-nav" : undefined}
    display={
      {
        sidebar: { base: "none", lg: "flex" },
        header: { base: "none", md: "flex", lg: "none" },
        bottom: { base: "flex", md: "none" },
      }[placement]
    }
    direction={placement === "sidebar" ? "column" : "row"}
    bg="bg.panel"
    borderTopWidth={placement === "bottom" ? "1px" : undefined}
    align={placement === "bottom" ? "center" : undefined}
    gap="1"
  >
    {navigation.map(({ to, label }) => (
      <Link
        key={to}
        asChild
        flex={placement === "bottom" ? "1" : undefined}
        justifyContent={placement === "bottom" ? "center" : "start"}
        minH="11"
        textAlign="center"
        px={placement === "bottom" ? "1" : "3"}
        py="2"
        borderRadius="md"
        fontSize={placement === "bottom" ? "xs" : "sm"}
        fontWeight="medium"
        color="fg.muted"
        _hover={{ bg: "bg.inset", textDecoration: "none" }}
        _currentPage={{ bg: "teal.subtle", color: "teal.fg", fontWeight: "bold" }}
      >
        <NavLink to={to} end={to === "/"}>
          {label}
        </NavLink>
      </Link>
    ))}
  </Flex>
);

export const AppLayout = () => {
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (main.current) main.current.scrollTop = 0;
  }, [pathname]);

  return (
    <Grid
      className="app-shell"
      minH="100dvh"
      templateColumns={{ base: "minmax(0, 1fr)", lg: "13rem minmax(0, 1fr)" }}
      templateRows="auto 1fr"
    >
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
      <Flex
        as="header"
        className="app-header"
        gridColumn="1 / -1"
        align="center"
        gap="4"
        justify="space-between"
        minH="16"
        px={{ base: "4", md: "6" }}
        bg="bg.panel"
        borderBottomWidth="1px"
      >
        <Text fontWeight="bold" fontSize="xl" letterSpacing="tight">
          Paideuo
        </Text>
        <Navigation placement="header" />
        <Popover.Root positioning={{ placement: "bottom-end" }}>
          <Popover.Trigger asChild>
            <Button variant="outline" size="sm">
              Account
            </Button>
          </Popover.Trigger>
          <Portal>
            <Popover.Positioner>
              <Popover.Content w="14rem" aria-label="Account settings">
                <Popover.Body>
                  <Stack gap="4">
                    <ColorModeControl />
                    <Button variant="outline" onClick={signOut}>
                      Sign out
                    </Button>
                  </Stack>
                </Popover.Body>
              </Popover.Content>
            </Popover.Positioner>
          </Portal>
        </Popover.Root>
      </Flex>
      <Box
        as="aside"
        display={{ base: "none", lg: "block" }}
        bg="bg.panel"
        borderInlineEndWidth="1px"
        p="4"
      >
        <Navigation placement="sidebar" />
      </Box>
      <Box
        as="main"
        ref={main}
        id="main-content"
        tabIndex={-1}
        className="app-content"
        maxW="100rem"
        w="full"
        mx="auto"
        px={{ base: "4", md: "6", xl: "8" }}
        py={{ base: "5", md: "8" }}
        minW="0"
      >
        <Outlet />
      </Box>
      <Navigation placement="bottom" />
    </Grid>
  );
};
