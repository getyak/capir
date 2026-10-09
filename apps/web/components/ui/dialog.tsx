"use client";

// shadcn's Radix composition, adapted to the workspace's existing tokens,
// Phosphor icons and quieter motion. The primitive owns modal accessibility.
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { Button } from "./button";
import styles from "./primitives.module.css";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;

type DialogContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  layout?: "center" | "search";
  showCloseButton?: boolean;
  closeLabel?: string;
};

function DialogContent({
  className,
  children,
  layout = "center",
  showCloseButton = true,
  closeLabel = "关闭",
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className={cn("ts-workspace-theme quiet-workspace", styles.overlay)}
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-layout={layout}
        className={cn("ts-workspace-theme quiet-workspace", styles.content, className)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className={styles.close} aria-label={closeLabel}>
              <X size={18} aria-hidden="true" />
            </Button>
          </DialogClose>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogTitle, DialogDescription };
