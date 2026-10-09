import { useState } from "react";
import { useMainline } from "./provider.tsx";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@xue-learn/core/source/src/components/ui/sheet.tsx";
export function MainlineFootprints() {
  const mainline = useMainline(),
    t = useT(),
    [open, setOpen] = useState(false);
  if (!mainline) return null;
  const latest = mainline.current ?? mainline.snapshot?.activities[0];
  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={!latest || mainline.busy}
        onClick={() => latest && void mainline.resume(latest)}
      >
        {t("mainline.continue")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {t("mainline.footprints")}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t("mainline.footprints")}</SheetTitle>
            <SheetDescription>
              {t("mainline.footprintsDescription")}
            </SheetDescription>
          </SheetHeader>
          <ol className="space-y-3 overflow-auto p-4">
            {mainline.snapshot?.activities.map((activity) => (
              <li
                key={activity.id}
                className="rounded-xl border border-border p-3"
              >
                <p className="text-xs text-muted-foreground">
                  {t(`mainline.kind.${activity.kind}`)} ·{" "}
                  {new Date(activity.createdAt).toLocaleString()}
                </p>
                <p className="mt-1 text-sm">{activity.title}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                    void mainline.resume(activity);
                  }}
                >
                  {t("mainline.open")}
                </Button>
              </li>
            ))}
          </ol>
        </SheetContent>
      </Sheet>
    </div>
  );
}
