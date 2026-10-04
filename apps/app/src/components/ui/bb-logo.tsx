import { cn } from "@bb/shared-ui/lib/utils";
import tyriaLogoUrl from "../../../../../assets/tyria-core-mark.svg";

export function BbLogo({ className = "size-4" }: { className?: string }) {
  return (
    <img
      src={tyriaLogoUrl}
      alt=""
      aria-hidden="true"
      className={cn(className, "object-contain dark:brightness-0 dark:invert")}
    />
  );
}
