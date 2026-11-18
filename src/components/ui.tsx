import { Badge, Box, Flex, Heading, Stack, Text, chakra } from "@chakra-ui/react";
import type { ReactNode } from "react";

export const Panel = chakra(Stack, {
  base: {
    bg: "bg.panel",
    borderWidth: "1px",
    borderColor: "border",
    borderRadius: "lg",
    p: { base: "4", md: "5" },
    gap: "3",
    minW: "0",
    overflowWrap: "anywhere",
  },
});

export const PageHeader = ({ title, action }: { title: string; action?: ReactNode }) => (
  <Flex
    align={{ base: "start", md: "center" }}
    justify="space-between"
    wrap="wrap"
    gap="3"
    pb="4"
    borderBottomWidth="1px"
  >
    <Heading
      as="h1"
      size={{ base: "2xl", md: "3xl" }}
      letterSpacing="tight"
      overflowWrap="anywhere"
    >
      {title}
    </Heading>
    {action}
  </Flex>
);

export const Notice = ({ children, role }: { children: ReactNode; role?: "alert" | "status" }) => (
  <Text
    role={role}
    bg={role === "alert" ? "red.subtle" : "bg.inset"}
    color={role === "alert" ? "red.fg" : "fg.muted"}
    borderRadius="md"
    px="3"
    py="2"
    overflowWrap="anywhere"
  >
    {children}
  </Text>
);

const statusPalette = { draft: "gray", active: "teal", completed: "green", archived: "gray" };

export const ProgramStatusBadge = ({ status }: { status: keyof typeof statusPalette }) => (
  <Badge colorPalette={statusPalette[status]} textTransform="capitalize" variant="subtle">
    {status}
  </Badge>
);

export const FormField = chakra("label", {
  base: { display: "grid", gap: "1.5", fontSize: "sm", fontWeight: "medium" },
});

export const Disclosure = ({ label, children }: { label: string; children: ReactNode }) => (
  <Box as="details" minW="0">
    <Box
      as="summary"
      cursor="pointer"
      w="fit-content"
      py={{ base: "3", md: "2" }}
      px="2"
      borderRadius="md"
      fontSize="sm"
      fontWeight="semibold"
      color="teal.fg"
      _hover={{ bg: "bg.inset" }}
    >
      {label}
    </Box>
    <Box pt="2">{children}</Box>
  </Box>
);
