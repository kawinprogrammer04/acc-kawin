import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "start", sideOffset = 4, ...props }, ref) => (
  // Deliberately NOT wrapped in <PopoverPrimitive.Portal>: when this Popover is
  // nested inside a Dialog, portaling to document.body puts the content in a
  // separate DOM subtree the Dialog's focus-trap / scroll-lock / dismiss-layer
  // machinery doesn't recognize as "inside" itself, breaking scroll and (per
  // observed behaviour) focus/click into the search input. Rendering in place
  // keeps it a plain DOM descendant, so it's covered by all of that for free.
  // (Popper still positions it via `position: fixed`, so layout is unaffected —
  // it just won't escape a `overflow-y-auto` ancestor that also has `transform`,
  // which is an acceptable trade-off here.)
  <PopoverPrimitive.Content
    ref={ref}
    align={align}
    sideOffset={sideOffset}
    className={cn(
      "z-50 rounded-md border bg-white text-foreground shadow-md outline-none",
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
      className
    )}
    {...props}
  />
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
