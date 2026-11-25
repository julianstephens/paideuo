import { Box, IconButton, Portal, Tooltip } from "@chakra-ui/react";
import type { ComponentProps, MouseEventHandler } from "react";
import { AppIcon } from "../../app/AppIcon";

export const CalendarAction = ({
  icon,
  label,
  compact,
  complete,
  onClick,
}: {
  icon: ComponentProps<typeof AppIcon>["name"];
  label: string;
  compact?: boolean;
  complete?: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
}) => (
  <Tooltip.Root openDelay={200}>
    <Tooltip.Trigger asChild>
      <IconButton
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        size="xs"
        boxSize={compact ? "32px" : "44px"}
        minW={compact ? "32px" : "44px"}
        variant={complete ? "subtle" : "ghost"}
        colorPalette={complete ? "green" : undefined}
        focusVisibleRing="inside"
        position="relative"
        onClick={onClick}
      >
        <AppIcon name={icon} size={18} />
        {complete && (
          <Box position="absolute" bottom="0.5" insetInlineEnd="0.5">
            <AppIcon name="check" size={11} />
          </Box>
        )}
      </IconButton>
    </Tooltip.Trigger>
    <Portal>
      <Tooltip.Positioner>
        <Tooltip.Content>{label}</Tooltip.Content>
      </Tooltip.Positioner>
    </Portal>
  </Tooltip.Root>
);
