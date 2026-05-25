import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, Cancel01Icon } from "@hugeicons/core-free-icons";

export function ErrorAlert({
  message,
  title = "Error",
  onDismiss,
  className,
}: {
  message: string;
  title?: string;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <Alert variant="destructive" className={className}>
      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      {onDismiss && (
        <AlertAction>
          <Button variant="ghost" size="icon-xs" onClick={onDismiss}>
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            <span className="sr-only">Dismiss</span>
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}
