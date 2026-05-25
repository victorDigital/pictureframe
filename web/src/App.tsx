import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Frame,
  ViewIcon,
  GridViewIcon,
  Clock01Icon,
  Settings02Icon,
  Download01Icon,
  ComputerIcon,
  ComputerTerminal01Icon,
  WrenchIcon,
  LockIcon,
  LoginCircle01Icon,
  Alert02Icon,
} from "@hugeicons/core-free-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { getToken, setToken } from "./api.js";
import { NowSection } from "./components/NowSection.js";
import { ScreensSection } from "./components/ScreensSection.js";
import { SystemSection } from "./components/SystemSection.js";
import { UpdatesSection } from "./components/UpdatesSection.js";
import { VncSection } from "./components/VncSection.js";
import { TerminalSection } from "./components/TerminalSection.js";
import { SettingsSection } from "./components/SettingsSection.js";
import { RulesSection } from "./components/RulesSection.js";

type Tab =
  | "now"
  | "screens"
  | "rules"
  | "system"
  | "updates"
  | "vnc"
  | "terminal"
  | "settings";

const NAV: ReadonlyArray<{
  id: Tab;
  label: string;
  icon: typeof Frame;
  group: "monitor" | "configure" | "service";
}> = [
  { id: "now", label: "Now showing", icon: ViewIcon, group: "monitor" },
  { id: "screens", label: "Screens", icon: GridViewIcon, group: "configure" },
  { id: "rules", label: "Schedule", icon: Clock01Icon, group: "configure" },
  { id: "settings", label: "Settings", icon: Settings02Icon, group: "configure" },
  { id: "updates", label: "Updates", icon: Download01Icon, group: "service" },
  { id: "system", label: "System", icon: WrenchIcon, group: "service" },
  { id: "vnc", label: "VNC", icon: ComputerIcon, group: "service" },
  { id: "terminal", label: "Terminal", icon: ComputerTerminal01Icon, group: "service" },
];

export function App() {
  const [authed, setAuthed] = useState<boolean>(Boolean(getToken()));
  const [tab, setTab] = useState<Tab>("now");
  const [publicIp, setPublicIp] = useState(false);

  useEffect(() => {
    if (!authed) return;
    fetch("/healthz")
      .then((r) => r.json())
      .then((b) => {
        if (b?.public_ip) setPublicIp(true);
      })
      .catch(() => {});
  }, [authed]);

  if (!authed) {
    return <Login onAuth={() => setAuthed(true)} />;
  }

  const groups: Record<string, typeof NAV[number][]> = {
    monitor: [],
    configure: [],
    service: [],
  };
  for (const item of NAV) groups[item.group]!.push(item);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent active:bg-transparent">
                <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <HugeiconsIcon icon={Frame} strokeWidth={2} className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-medium">Picture Frame</span>
                  <span className="truncate text-[10px] text-muted-foreground">Control panel</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <Separator />
        <SidebarContent>
          {(["monitor", "configure", "service"] as const).map((g) => (
            <SidebarGroup key={g}>
              <SidebarGroupLabel className="capitalize">{g}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {groups[g]!.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={tab === item.id}
                        tooltip={item.label}
                        onClick={() => setTab(item.id)}
                      >
                        <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <div className="px-2 py-1 text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
            ⌘B to toggle
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-border/60 bg-background/80 px-3 backdrop-blur">
          <SidebarTrigger />
          <div className="text-sm font-medium">
            {NAV.find((n) => n.id === tab)?.label}
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 sm:p-6">
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {publicIp && (
              <Alert variant="destructive">
                <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
                <AlertTitle>Public IP detected</AlertTitle>
                <AlertDescription>
                  The bearer-token model assumes a trusted LAN. Expose only behind a reverse
                  proxy or Tailscale.
                </AlertDescription>
              </Alert>
            )}
            {tab === "now" && <NowSection />}
            {tab === "screens" && <ScreensSection />}
            {tab === "rules" && <RulesSection />}
            {tab === "system" && <SystemSection />}
            {tab === "updates" && <UpdatesSection />}
            {tab === "vnc" && <VncSection />}
            {tab === "terminal" && <TerminalSection />}
            {tab === "settings" && (
              <SettingsSection
                onSignOut={() => {
                  setToken(null);
                  setAuthed(false);
                }}
              />
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function Login({ onAuth }: { onAuth: () => void }) {
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setToken(value);
    try {
      const res = await fetch("/api/state", {
        headers: { Authorization: `Bearer ${value}` },
      });
      if (res.ok) onAuth();
      else {
        setErr("Bearer token rejected.");
        setToken(null);
      }
    } catch {
      setErr("Could not reach frame-core.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <HugeiconsIcon icon={Frame} strokeWidth={2} className="size-5" />
          </div>
          <CardTitle>Picture Frame</CardTitle>
          <CardDescription>
            Enter the bearer token from <code className="rounded bg-muted px-1 py-0.5 text-[10px]">/etc/frame/secrets/bearer_token</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="token">Bearer token</Label>
              <div className="relative">
                <HugeiconsIcon
                  icon={LockIcon}
                  strokeWidth={2}
                  className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="token"
                  type="password"
                  placeholder="••••••••"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="pl-7"
                  autoFocus
                />
              </div>
            </div>
            {err && (
              <Alert variant="destructive">
                <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
                <AlertDescription>{err}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={!value || busy} className="w-full">
              <HugeiconsIcon icon={LoginCircle01Icon} strokeWidth={2} />
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
