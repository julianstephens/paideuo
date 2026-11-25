import { Button, Popover, Text } from "@chakra-ui/react";
import { useRef, useState } from "react";

export const FieldHelp = ({
  label,
  description,
  id,
}: {
  label: string;
  description: string;
  id: string;
}) => {
  const trigger = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState(false);
  const [pinned, setPinned] = useState(false);
  const dismiss = () => {
    setPreview(false);
    setPinned(false);
  };

  return (
    <>
      <Text id={id} as="span" srOnly>
        {description}
      </Text>
      <Popover.Root
        open={preview || pinned}
        onOpenChange={({ open }) => {
          if (!open) dismiss();
        }}
        autoFocus={false}
        persistentElements={[() => trigger.current]}
        positioning={{ strategy: "fixed", placement: "bottom-start" }}
      >
        <Popover.Anchor asChild>
          <Button
            ref={trigger}
            type="button"
            size="xs"
            variant="ghost"
            px="0"
            minW={{ base: "11", md: "7" }}
            color="teal.fg"
            data-field-help
            aria-label={`About ${label}`}
            aria-describedby={id}
            aria-expanded={preview || pinned}
            aria-controls={`${id}-popover`}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") setPreview(true);
            }}
            onPointerLeave={() => setPreview(false)}
            onFocus={(event) => {
              if (event.currentTarget.matches(":focus-visible")) setPreview(true);
            }}
            onBlur={() => setPreview(false)}
            onClick={() => {
              if (pinned) dismiss();
              else setPinned(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && (preview || pinned)) {
                event.stopPropagation();
                dismiss();
              }
            }}
          >
            <Text
              as="span"
              aria-hidden="true"
              borderWidth="1px"
              borderRadius="full"
              boxSize="4"
              lineHeight="shorter"
              fontFamily="serif"
              fontSize="xs"
            >
              i
            </Text>
          </Button>
        </Popover.Anchor>
        <Popover.Positioner>
          <Popover.Content
            id={`${id}-popover`}
            w="16rem"
            maxW="calc(100vw - 2rem)"
            aria-label={label}
          >
            <Popover.Body p="3" fontSize="sm">
              {description}
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Popover.Root>
    </>
  );
};
