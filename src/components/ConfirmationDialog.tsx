import { Button, Dialog, Portal } from "@chakra-ui/react";
import { useRef } from "react";
import type { ReactNode } from "react";

export const ConfirmationDialog = ({
  title,
  description,
  confirmLabel,
  destructive = false,
  children,
  returnFocus,
  onConfirm,
  onDismiss,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  children?: ReactNode;
  returnFocus: () => HTMLElement | null;
  onConfirm: () => void;
  onDismiss: () => void;
}) => {
  const cancel = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);

  return (
    <Dialog.Root
      open
      role="alertdialog"
      size="sm"
      placement="center"
      scrollBehavior="inside"
      closeOnInteractOutside={false}
      initialFocusEl={() => cancel.current}
      finalFocusEl={returnFocus}
      onOpenChange={({ open }) => {
        if (!open) onDismiss();
      }}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner p="3">
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>{title}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body display="flex" flexDirection="column" gap="3">
              <Dialog.Description>{description}</Dialog.Description>
              {children}
            </Dialog.Body>
            <Dialog.Footer flexWrap="wrap">
              <Dialog.CloseTrigger asChild position="static">
                <Button ref={cancel} type="button" variant="outline">
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                type="button"
                colorPalette={destructive ? "red" : "teal"}
                onClick={() => {
                  if (confirmed.current) return;
                  confirmed.current = true;
                  onDismiss();
                  onConfirm();
                }}
              >
                {confirmLabel}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
};
