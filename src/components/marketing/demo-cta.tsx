import { startDemoSession } from "@/app/actions/demo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DemoCta({
  size = "md",
  className,
  label = "View live demo",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
}) {
  return (
    <form action={startDemoSession}>
      <Button type="submit" size={size} className={cn(className)}>
        {label}
      </Button>
    </form>
  );
}
