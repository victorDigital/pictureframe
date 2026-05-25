import { useEffect, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Clock01Icon,
  Delete01Icon,
  PencilEdit01Icon,
  PlusSignIcon,
  ToggleOffIcon,
  ToggleOnIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "../api.js";
import { ConfirmButton } from "./common/ConfirmButton.js";
import { ErrorAlert } from "./common/ErrorAlert.js";
import { PageHeader } from "./common/PageHeader.js";

type Rule = {
  id: string;
  cron: string;
  screenId: string;
  durationMin?: number;
  enabled: boolean;
};

type Screen = { id: string; name: string };

export function RulesSection() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [draft, setDraft] = useState<Rule | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      const [r, s] = await Promise.all([
        api<{ rules: Rule[] }>("/api/rules"),
        api<{ screens: Screen[] }>("/api/screens"),
      ]);
      setRules(r.rules);
      setScreens(s.screens);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function save(rule: Rule) {
    const exists = rules.find((r) => r.id === rule.id);
    const next = exists
      ? rules.map((r) => (r.id === rule.id ? rule : r))
      : [...rules, rule];
    try {
      await api("/api/rules", { method: "PUT", body: JSON.stringify({ rules: next }) });
      toast.success(exists ? `Updated ${rule.id}` : `Created ${rule.id}`);
      setDraft(null);
      refresh();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  async function remove(id: string) {
    const next = rules.filter((r) => r.id !== id);
    try {
      await api("/api/rules", { method: "PUT", body: JSON.stringify({ rules: next }) });
      toast.success(`Deleted ${id}`);
      refresh();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  async function toggle(rule: Rule) {
    await save({ ...rule, enabled: !rule.enabled });
  }

  if (draft) {
    return (
      <RuleEditor
        draft={draft}
        screens={screens}
        onCancel={() => setDraft(null)}
        onSave={save}
      />
    );
  }

  if (err && rules.length === 0) {
    return <ErrorAlert message={err} onDismiss={() => setErr(null)} />;
  }

  return (
    <>
      <PageHeader
        title="Schedule"
        description="Cron expressions claim a screen at the configured time. See SPEC §4.7."
        actions={
          <Button
            onClick={() =>
              setDraft({
                id: "",
                cron: "0 9 * * 1-5",
                screenId: screens[0]?.id ?? "",
                enabled: true,
              })
            }
          >
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
            Add rule
          </Button>
        }
      />

      {err && <ErrorAlert message={err} onDismiss={() => setErr(null)} />}

      <Card>
        <CardContent className="p-0">
          {rules.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">No rules.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {rules.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-[14rem]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs">{r.id}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-medium">{r.screenId}</span>
                      {!r.enabled && <Badge variant="outline">disabled</Badge>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <HugeiconsIcon icon={Clock01Icon} strokeWidth={2} className="size-3" />
                      <code className="rounded bg-muted px-1 py-0.5 text-[10px]">{r.cron}</code>
                      {r.durationMin && (
                        <span>· holds {r.durationMin} min</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" onClick={() => toggle(r)}>
                      <HugeiconsIcon
                        icon={r.enabled ? ToggleOnIcon : ToggleOffIcon}
                        strokeWidth={2}
                      />
                      {r.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDraft(r)}>
                      <HugeiconsIcon icon={PencilEdit01Icon} strokeWidth={2} />
                      Edit
                    </Button>
                    <ConfirmButton
                      variant="ghost"
                      size="sm"
                      destructive
                      title={`Delete rule "${r.id}"?`}
                      description="The rule stops firing immediately."
                      confirmLabel="Delete"
                      onConfirm={() => remove(r.id)}
                    >
                      <HugeiconsIcon icon={Delete01Icon} strokeWidth={2} />
                    </ConfirmButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function RuleEditor({
  draft,
  screens,
  onCancel,
  onSave,
}: {
  draft: Rule;
  screens: Screen[];
  onCancel: () => void;
  onSave: (r: Rule) => void;
}) {
  const [d, setD] = useState<Rule>(draft);
  const update = <K extends keyof Rule>(key: K, value: Rule[K]) =>
    setD({ ...d, [key]: value });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={onCancel}>
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
          </Button>
          <CardTitle>{draft.id ? `Edit: ${draft.id}` : "New rule"}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-1.5">
          <Label>ID</Label>
          <Input
            value={d.id}
            disabled={Boolean(draft.id)}
            onChange={(e) => update("id", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Cron expression</Label>
          <Input
            value={d.cron}
            onChange={(e) => update("cron", e.target.value)}
            className="font-mono"
          />
          <p className="text-[10px] text-muted-foreground">
            5 fields: minute hour day month weekday. Example:{" "}
            <code className="rounded bg-muted px-1">0 9 * * 1-5</code> = weekdays at 9am.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Screen</Label>
          <Select value={d.screenId} onValueChange={(v) => update("screenId", v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {screens.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Hold duration (min, optional)</Label>
          <Input
            type="number"
            value={d.durationMin ?? ""}
            onChange={(e) =>
              update("durationMin", e.target.value ? Number(e.target.value) : undefined)
            }
          />
        </div>
        <div className="flex items-center gap-2 pt-2">
          <Button
            onClick={() => onSave(d)}
            disabled={!d.id || !d.cron || !d.screenId}
          >
            Save
          </Button>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
