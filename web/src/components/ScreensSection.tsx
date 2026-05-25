import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  Delete01Icon,
  FilterIcon,
  PencilEdit01Icon,
  PinIcon,
  PlayIcon,
  PlusSignIcon,
  Tag01Icon,
  WrenchIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { api } from "../api.js";
import { ConfirmButton } from "./common/ConfirmButton.js";
import { ErrorAlert } from "./common/ErrorAlert.js";
import { PageHeader } from "./common/PageHeader.js";

type PropSchema = {
  type?: string;
  default?: unknown;
  enum?: string[];
  description?: string;
  minimum?: number;
  maximum?: number;
  items?: PropSchema & { required?: string[]; properties?: Record<string, PropSchema> };
  properties?: Record<string, PropSchema>;
  required?: string[];
};

type BuiltinManifest = {
  id: string;
  name?: string;
  description?: string;
  stub?: boolean;
  config_schema?: {
    type?: string;
    required?: string[];
    properties?: Record<string, PropSchema>;
  };
};

function validateConfig(
  config: Record<string, unknown> | undefined,
  schema: BuiltinManifest["config_schema"],
): string[] {
  if (!schema?.properties) return [];
  const errors: string[] = [];
  const cfg = config ?? {};
  for (const key of schema.required ?? []) {
    const v = cfg[key];
    if (v === undefined || v === null || v === "") {
      errors.push(`"${key}" is required`);
    }
  }
  for (const [key, prop] of Object.entries(schema.properties)) {
    const v = cfg[key];
    if (v === undefined || v === null || v === "") continue;
    if (prop.enum && !prop.enum.includes(String(v))) {
      errors.push(`"${key}" must be one of: ${prop.enum.join(", ")}`);
    }
    if ((prop.type === "integer" || prop.type === "number") && typeof v !== "number") {
      errors.push(`"${key}" must be a number`);
    }
    if (prop.type === "boolean" && typeof v !== "boolean") {
      errors.push(`"${key}" must be a boolean`);
    }
    if (prop.type === "array" && !Array.isArray(v)) {
      errors.push(`"${key}" must be an array`);
    }
    if (typeof v === "number") {
      if (prop.minimum !== undefined && v < prop.minimum) {
        errors.push(`"${key}" must be ≥ ${prop.minimum}`);
      }
      if (prop.maximum !== undefined && v > prop.maximum) {
        errors.push(`"${key}" must be ≤ ${prop.maximum}`);
      }
    }
  }
  return errors;
}

type Screen = {
  id: string;
  name: string;
  type: "url" | "builtin";
  source: string;
  preload: boolean;
  transitionMs?: number;
  reloadIntervalSec?: number;
  tags?: string[];
  config?: Record<string, unknown>;
};

type TestResult = {
  ok: boolean;
  httpStatus?: number;
  finalUrl?: string;
  loaded: boolean;
  consoleErrors: string[];
  screenshot?: string;
  error?: string;
};

export function ScreensSection() {
  const [screens, setScreens] = useState<Screen[]>([]);
  const [editing, setEditing] = useState<Screen | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string>("");
  const [testResult, setTestResult] = useState<{ id: string; result: TestResult } | null>(null);

  async function refresh() {
    try {
      const b = await api<{ screens: Screen[] }>("/api/screens");
      setScreens(b.screens);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function show(id: string, mode: "next" | "pin") {
    try {
      await api(`/api/screens/${id}/show`, {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      toast.success(mode === "pin" ? `Pinned ${id}` : `Queued ${id}`);
    } catch (e) {
      toast.error(`Show failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function remove(id: string) {
    const next = screens.filter((s) => s.id !== id);
    try {
      await api("/api/screens", { method: "PUT", body: JSON.stringify({ screens: next }) });
      toast.success(`Deleted ${id}`);
      refresh();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  async function test(id: string) {
    setTestResult({ id, result: { ok: false, loaded: false, consoleErrors: [] } });
    try {
      const result = await api<TestResult>(`/api/screens/${id}/test`, { method: "POST" });
      setTestResult({ id, result });
    } catch (e) {
      setTestResult({
        id,
        result: { ok: false, loaded: false, consoleErrors: [], error: String(e) },
      });
    }
  }

  async function save(updated: Screen) {
    const exists = screens.find((s) => s.id === updated.id);
    const next = exists ? screens.map((s) => (s.id === updated.id ? updated : s)) : [...screens, updated];
    try {
      await api("/api/screens", { method: "PUT", body: JSON.stringify({ screens: next }) });
      toast.success(exists ? `Updated ${updated.id}` : `Created ${updated.id}`);
      setEditing(null);
      refresh();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }

  if (editing) {
    return (
      <ScreenEditor
        screen={editing}
        onCancel={() => {
          setEditing(null);
          setErr(null);
        }}
        onSave={save}
        error={err}
      />
    );
  }

  const allTags = Array.from(new Set(screens.flatMap((s) => s.tags ?? []))).sort();
  const visible = tagFilter
    ? screens.filter((s) => (s.tags ?? []).includes(tagFilter))
    : screens;

  return (
    <>
      <PageHeader
        title="Screens"
        description="Configure URL or built-in screens. Triggers show now, pin, or test."
        actions={
          <Button
            onClick={() =>
              setEditing({ id: "", name: "", type: "url", source: "", preload: false })
            }
          >
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
            Add screen
          </Button>
        }
      />

      {err && <ErrorAlert message={err} onDismiss={() => setErr(null)} />}

      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <HugeiconsIcon
            icon={FilterIcon}
            strokeWidth={2}
            className="size-3.5 text-muted-foreground"
          />
          <Button
            variant={tagFilter === "" ? "default" : "outline"}
            size="xs"
            onClick={() => setTagFilter("")}
          >
            all
          </Button>
          {allTags.map((t) => (
            <Button
              key={t}
              variant={tagFilter === t ? "default" : "outline"}
              size="xs"
              onClick={() => setTagFilter(t)}
            >
              #{t}
            </Button>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {visible.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              {screens.length === 0 ? "No screens configured." : "No screens match filter."}
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {visible.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <div className="flex-1 min-w-[12rem]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{s.name}</span>
                      <Badge variant="outline" className="font-mono">
                        {s.id}
                      </Badge>
                      {(s.tags ?? []).map((t) => (
                        <Badge key={t} variant="secondary">
                          <HugeiconsIcon icon={Tag01Icon} strokeWidth={2} />
                          {t}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      <span className="capitalize">{s.type}</span> · {s.source}
                      {s.preload && " · preload"}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Button size="sm" onClick={() => show(s.id, "next")}>
                      <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />
                      Show
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => show(s.id, "pin")}>
                      <HugeiconsIcon icon={PinIcon} strokeWidth={2} />
                      Pin
                    </Button>
                    {s.type === "url" && (
                      <Button variant="ghost" size="sm" onClick={() => test(s.id)}>
                        <HugeiconsIcon icon={WrenchIcon} strokeWidth={2} />
                        Test
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                      <HugeiconsIcon icon={PencilEdit01Icon} strokeWidth={2} />
                      Edit
                    </Button>
                    <ConfirmButton
                      variant="ghost"
                      size="sm"
                      destructive
                      title={`Delete screen "${s.id}"?`}
                      description="This removes the screen from the configured list. Active claims will fall back to the default screen."
                      confirmLabel="Delete"
                      onConfirm={() => remove(s.id)}
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

      {testResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {testResult.result.ok ? (
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  strokeWidth={2}
                  className="size-4 text-emerald-500"
                />
              ) : (
                <HugeiconsIcon
                  icon={Alert02Icon}
                  strokeWidth={2}
                  className="size-4 text-destructive"
                />
              )}
              Test: <code className="font-mono">{testResult.id}</code>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {testResult.result.error && (
              <Alert variant="destructive">
                <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
                <AlertDescription>{testResult.result.error}</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-[8rem_1fr] gap-y-1 text-xs">
              <span className="text-muted-foreground">HTTP</span>
              <span>{testResult.result.httpStatus ?? "—"}</span>
              <span className="text-muted-foreground">Loaded</span>
              <span>{String(testResult.result.loaded)}</span>
              <span className="text-muted-foreground">Final URL</span>
              <span className="truncate">{testResult.result.finalUrl ?? "—"}</span>
            </div>
            {testResult.result.consoleErrors.length > 0 && (
              <details className="rounded border border-border/60">
                <summary className="cursor-pointer px-2 py-1 text-xs">
                  Console errors ({testResult.result.consoleErrors.length})
                </summary>
                <pre className="overflow-auto border-t border-border/60 bg-muted/40 p-2 text-[10px]">
                  {testResult.result.consoleErrors.join("\n")}
                </pre>
              </details>
            )}
            {testResult.result.screenshot && (
              <img
                src={testResult.result.screenshot}
                alt="screenshot"
                className="w-full rounded-md border border-border/60"
              />
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function ScreenEditor({
  screen,
  onCancel,
  onSave,
  error,
}: {
  screen: Screen;
  onCancel: () => void;
  onSave: (s: Screen) => void;
  error?: string | null;
}) {
  const [draft, setDraft] = useState<Screen>(screen);
  const [builtins, setBuiltins] = useState<BuiltinManifest[]>([]);
  const [rawJson, setRawJson] = useState(false);
  const [tagInput, setTagInput] = useState<string>((screen.tags ?? []).join(", "));

  useEffect(() => {
    api<{ builtins: BuiltinManifest[] }>("/api/builtins")
      .then((b) => setBuiltins(b.builtins))
      .catch(() => undefined);
  }, []);

  const manifest = useMemo(
    () =>
      draft.type === "builtin" ? builtins.find((b) => b.id === draft.source) : undefined,
    [builtins, draft.type, draft.source],
  );

  const validationErrors = useMemo(
    () => (manifest ? validateConfig(draft.config, manifest.config_schema) : []),
    [manifest, draft.config],
  );

  const update = <K extends keyof Screen>(key: K, value: Screen[K]) =>
    setDraft({ ...draft, [key]: value });
  const updateConfig = (k: string, v: unknown) => {
    const next = { ...(draft.config ?? {}) };
    if (v === undefined) delete next[k];
    else next[k] = v;
    setDraft({ ...draft, config: Object.keys(next).length ? next : undefined });
  };

  function renderManifestField(key: string, schema: PropSchema) {
    const current = draft.config?.[key];
    const value =
      current !== undefined ? current : "default" in schema ? schema.default : "";

    if (schema.enum) {
      return (
        <Select
          value={String(value ?? "")}
          onValueChange={(v) => updateConfig(key, v || undefined)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="(unset)" />
          </SelectTrigger>
          <SelectContent>
            {schema.enum.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (schema.type === "boolean") {
      return (
        <div className="flex items-center gap-2">
          <Switch
            checked={Boolean(value)}
            onCheckedChange={(checked) => updateConfig(key, checked)}
          />
          <span className="text-xs text-muted-foreground">
            {schema.description ?? "Enabled"}
          </span>
        </div>
      );
    }

    if (schema.type === "integer" || schema.type === "number") {
      return (
        <Input
          type="number"
          min={schema.minimum}
          max={schema.maximum}
          value={value as number | string}
          onChange={(e) =>
            updateConfig(key, e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      );
    }

    if (schema.type === "array") {
      const arrValue = Array.isArray(value) ? value : [];
      return (
        <Textarea
          rows={Math.max(3, arrValue.length + 1)}
          defaultValue={JSON.stringify(arrValue, null, 2)}
          onChange={(e) => {
            const text = e.target.value.trim();
            if (!text) {
              updateConfig(key, undefined);
              return;
            }
            try {
              const parsed = JSON.parse(text) as unknown;
              if (Array.isArray(parsed)) updateConfig(key, parsed);
            } catch {
              // ignore until JSON parses
            }
          }}
          className="font-mono text-xs"
        />
      );
    }

    return (
      <Input
        type="text"
        value={(value as string) ?? ""}
        onChange={(e) => updateConfig(key, e.target.value || undefined)}
      />
    );
  }

  const builtinSourceMissing =
    draft.type === "builtin" &&
    draft.source !== "" &&
    builtins.length > 0 &&
    !builtins.some((b) => b.id === draft.source);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={onCancel}>
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
          </Button>
          <CardTitle>{screen.id ? `Edit: ${screen.id}` : "New screen"}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <ErrorAlert message={error} />}

        <Field label="ID" hint="lowercase, hyphenated">
          <Input
            value={draft.id}
            disabled={Boolean(screen.id)}
            onChange={(e) => update("id", e.target.value)}
          />
        </Field>

        <Field label="Name">
          <Input value={draft.name} onChange={(e) => update("name", e.target.value)} />
        </Field>

        <Field label="Type">
          <Select
            value={draft.type}
            onValueChange={(v) => update("type", v as Screen["type"])}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="url">URL</SelectItem>
              <SelectItem value="builtin">Built-in</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label={draft.type === "url" ? "URL" : "Built-in source"}>
          {draft.type === "builtin" ? (
            <Select value={draft.source} onValueChange={(v) => update("source", v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="— pick one —" />
              </SelectTrigger>
              <SelectContent>
                {builtinSourceMissing && (
                  <SelectItem value={draft.source}>{draft.source} (unknown)</SelectItem>
                )}
                {builtins.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name ?? b.id}
                    {b.stub ? " (stub)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input value={draft.source} onChange={(e) => update("source", e.target.value)} />
          )}
        </Field>

        {draft.type === "url" && (
          <Field label="Reload interval (sec)">
            <Input
              type="number"
              value={draft.reloadIntervalSec ?? ""}
              onChange={(e) =>
                update("reloadIntervalSec", e.target.value ? Number(e.target.value) : undefined)
              }
            />
          </Field>
        )}

        <Field label="Transition (ms)">
          <Input
            type="number"
            value={draft.transitionMs ?? ""}
            onChange={(e) =>
              update("transitionMs", e.target.value ? Number(e.target.value) : undefined)
            }
          />
        </Field>

        <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card/40 px-3 py-2">
          <div>
            <div className="text-xs font-medium">Preload</div>
            <div className="text-[10px] text-muted-foreground">Keep this screen in memory</div>
          </div>
          <Switch
            checked={draft.preload}
            onCheckedChange={(v) => update("preload", v)}
          />
        </div>

        <Field label="Tags" hint="comma separated">
          <Input
            value={tagInput}
            onChange={(e) => {
              setTagInput(e.target.value);
              const tags = e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean);
              update("tags", tags.length ? tags : undefined);
            }}
          />
        </Field>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">Config</h3>
            {manifest?.config_schema?.properties && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRawJson((v) => !v)}
              >
                {rawJson ? "Use form" : "Edit as JSON"}
              </Button>
            )}
          </div>
          {manifest?.description && (
            <p className="text-xs text-muted-foreground">{manifest.description}</p>
          )}
          {manifest?.config_schema?.properties && !rawJson ? (
            Object.entries(manifest.config_schema.properties).map(([key, schema]) => (
              <Field
                key={key}
                label={key}
                required={(manifest.config_schema?.required ?? []).includes(key)}
                hint={schema.type !== "boolean" ? schema.description : undefined}
              >
                {renderManifestField(key, schema)}
              </Field>
            ))
          ) : (
            <Textarea
              rows={6}
              defaultValue={draft.config ? JSON.stringify(draft.config, null, 2) : ""}
              onChange={(e) => {
                try {
                  update(
                    "config",
                    e.target.value
                      ? (JSON.parse(e.target.value) as Record<string, unknown>)
                      : undefined,
                  );
                } catch {
                  // ignore until valid
                }
              }}
              className="font-mono text-xs"
            />
          )}
        </div>

        {validationErrors.length > 0 && (
          <Alert variant="destructive">
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
            <AlertTitle>Config issues</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {validationErrors.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-2 pt-2">
          <Button
            onClick={() => onSave(draft)}
            disabled={
              !draft.id || !draft.name || !draft.source || validationErrors.length > 0
            }
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

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
