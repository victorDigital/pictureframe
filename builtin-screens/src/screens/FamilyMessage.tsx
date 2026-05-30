import { useEffect, useState } from "react";
import type { Config } from "../shared";
import { boolValue, fetchWithTimeout, formatTime, Shell, stringValue, weightClass } from "../shared";

export function FamilyMessageScreen({ config }: { config: Config }) {
  const [message, setMessage] = useState<string | null>(null);
  const [empty, setEmpty] = useState("Loading...");
  const [meta, setMeta] = useState("");
  const align = stringValue(config.text_align, "center");
  const showFooter = boolValue(config.show_footer, true);
  const signature = stringValue(config.signature_text, "").trim();
  const alignClass = align === "left" ? "items-start text-left" : align === "right" ? "items-end text-right" : "items-center text-center";
  const weight = weightClass[stringValue(config.font_weight, "normal")] ?? "font-normal";
  useEffect(() => {
    let disposed = false;
    async function refresh() {
      try {
        const res = await fetchWithTimeout("/api/family_message/current");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { message?: string; posted_at?: string; expires_at?: number };
        if (disposed) return;
        if (!data.message) {
          setMessage(null);
          setEmpty("No message.");
          setMeta("");
          return;
        }
        setMessage(data.message);
        const posted = data.posted_at ? formatTime(new Date(data.posted_at)) : "";
        const mins = data.expires_at ? Math.max(0, Math.round((data.expires_at - Date.now()) / 60000)) : 0;
        setMeta(posted ? `Posted ${posted} - visible for ${mins} min` : "");
      } catch (err) {
        if (!disposed) {
          setMessage(null);
          setEmpty(String(err));
          setMeta("");
        }
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  return (
    <Shell className={`flex flex-col justify-center px-8 py-12 ${alignClass}`}>
      <blockquote className={`m-0 w-full max-w-4xl text-balance text-title-lg leading-snug ${weight}`}>
        {message ? message : <span className="text-title-sm font-normal text-muted-foreground">{empty}</span>}
      </blockquote>
      {signature ? <p className="mt-6 w-full max-w-4xl text-body text-primary">{signature}</p> : null}
      {showFooter ? <footer className="fixed inset-x-0 bottom-0 px-8 pb-8 text-center text-caption tabular-nums">{meta}</footer> : null}
    </Shell>
  );
}
