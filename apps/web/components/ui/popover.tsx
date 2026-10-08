"use client";

// shadcn's Radix composition; keep the workspace palette on body portals.
import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";
import styles from "./primitives.module.css";

const Popover = PopoverPrimitive.Root;
const subscribeToReadiness = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>(({ disabled, ...props }, ref) => {
  const ready = React.useSyncExternalStore(subscribeToReadiness, clientReady, serverReady);
  // Server-painted controls must not promise an action before their handler
  // is attached. Native disabled semantics cover that brief hydration window.
  return <PopoverPrimitive.Trigger ref={ref} {...props} disabled={disabled || !ready} />;
});
PopoverTrigger.displayName = "PopoverTrigger";
const PopoverAnchor = PopoverPrimitive.Anchor;
const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "start", sideOffset = 8, collisionPadding = 16, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      data-slot="popover-content"
      align={align}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn("ts-workspace-theme quiet-workspace", styles.popover, className)}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = "PopoverContent";

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
