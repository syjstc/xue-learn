import * as React from "react"

import { cn } from "@xue-learn/core/utils"

function Card({
  className,
  size = "default",
  elevated = false,
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm"; elevated?: boolean }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-elevated={elevated}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-[var(--card-radius)] border border-[var(--card-border-color)] bg-[var(--card-background)] p-(--card-spacing) text-sm text-card-foreground shadow-[var(--card-shadow-resting)] [--card-spacing:var(--card-padding)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[elevated=true]:shadow-[var(--card-shadow-elevated)] data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-[var(--card-radius)] *:[img:last-child]:rounded-b-[var(--card-radius)]",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-[var(--card-radius)] has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={className}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "-mx-(--card-spacing) flex items-center rounded-b-[var(--card-radius)] border-t bg-muted/50 px-(--card-spacing) py-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
