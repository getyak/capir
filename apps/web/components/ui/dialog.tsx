"use client";

// shadcn's Radix composition, adapted to the workspace's existing tokens,
// Phosphor icons and quieter motion. The primitive owns modal accessibility.
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { useLocale } from "../locale-provider";
import { Button } from "./button";
import styles from "./primitives.module.css";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;

type DialogContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** Custom frames retain their own geometry and scroll owner. */
  layout?: "center" | "search" | "custom";
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
  const locale = useLocale();
  const owner = React.useId();
  React.useLayoutEffect(() => {
    // Radix's document-capture Escape handler does not distinguish marked text.
    // Register before its passive effect, without cancelling the IME default.
    function preserveComposition(event: KeyboardEvent) {
      if (event.key !== "Escape" || (!event.isComposing && event.keyCode !== 229)) return;
      if (event.target instanceof Element && event.target.closest("[data-dialog-owner]")?.getAttribute("data-dialog-owner") === owner) {
        event.stopImmediatePropagation();
      }
    }
    document.addEventListener("keydown", preserveComposition, true);
    return () => document.removeEventListener("keydown", preserveComposition, true);
  }, [owner]);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className={cn("ts-workspace-theme quiet-workspace", styles.overlay)}
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-layout={layout}
        data-dialog-owner={owner}
        data-has-close={showCloseButton || undefined}
        lang={locale}
        className={cn("ts-workspace-theme quiet-workspace", styles.modalLayer, layout === "custom" ? styles.customContent : styles.content, className)}
        {...props}
      >
        {layout === "custom" ? children : <div data-slot="dialog-scroll" className={styles.scroller}>{children}</div>}
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
