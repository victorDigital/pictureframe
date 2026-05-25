/**
 * Format and render Zod-style flatten() validation details for the emergency screen.
 * Matches the structured display used in the web admin safe-mode alert.
 */

/**
 * @param {unknown} details
 * @returns {boolean}
 */
export function hasStructuredDetails(details) {
  if (details == null) return false;
  if (typeof details === "string") return details.trim().length > 0;
  if (typeof details !== "object") return false;
  const d = /** @type {Record<string, unknown>} */ (details);
  const form = Array.isArray(d.formErrors) ? d.formErrors : [];
  const fields = d.fieldErrors && typeof d.fieldErrors === "object" ? d.fieldErrors : {};
  if (form.length > 0) return true;
  return Object.keys(fields).length > 0;
}

/**
 * @param {unknown} details
 * @returns {string}
 */
export function formatDetailsPlain(details) {
  if (details == null) return "";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

/**
 * @param {HTMLElement} container
 * @param {unknown} details
 */
export function renderValidationDetails(container, details) {
  container.replaceChildren();

  if (details == null) {
    container.hidden = true;
    return;
  }

  if (typeof details === "string") {
    const pre = document.createElement("pre");
    pre.className =
      "overflow-auto rounded-md border border-border/60 bg-background/50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90";
    pre.textContent = details;
    container.appendChild(pre);
    container.hidden = false;
    return;
  }

  if (typeof details !== "object") {
    const pre = document.createElement("pre");
    pre.className =
      "overflow-auto rounded-md border border-border/60 bg-background/50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90";
    pre.textContent = String(details);
    container.appendChild(pre);
    container.hidden = false;
    return;
  }

  const d = /** @type {{ formErrors?: string[]; fieldErrors?: Record<string, string[]> }} */ (
    details
  );
  const formErrors = Array.isArray(d.formErrors) ? d.formErrors : [];
  const fieldErrors =
    d.fieldErrors && typeof d.fieldErrors === "object" ? d.fieldErrors : {};

  const hasFields = Object.keys(fieldErrors).length > 0;
  if (formErrors.length === 0 && !hasFields) {
    const pre = document.createElement("pre");
    pre.className =
      "overflow-auto rounded-md border border-border/60 bg-background/50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90";
    pre.textContent = formatDetailsPlain(details);
    container.appendChild(pre);
    container.hidden = false;
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "flex flex-col gap-3";

  if (formErrors.length > 0) {
    const block = document.createElement("div");
    block.className = "flex flex-col gap-1";
    const label = document.createElement("div");
    label.className = "text-eyebrow";
    label.textContent = "Form errors";
    block.appendChild(label);
    const ul = document.createElement("ul");
    ul.className = "list-disc pl-5 text-sm text-destructive/90 space-y-1";
    for (const msg of formErrors) {
      const li = document.createElement("li");
      li.textContent = msg;
      ul.appendChild(li);
    }
    block.appendChild(ul);
    wrap.appendChild(block);
  }

  if (hasFields) {
    const block = document.createElement("div");
    block.className = "flex flex-col gap-2";
    const label = document.createElement("div");
    label.className = "text-eyebrow";
    label.textContent = "Field errors";
    block.appendChild(label);
    const list = document.createElement("dl");
    list.className = "flex flex-col gap-2";
    for (const [path, messages] of Object.entries(fieldErrors)) {
      const msgs = Array.isArray(messages) ? messages : [String(messages)];
      const row = document.createElement("div");
      row.className =
        "rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2";
      const dt = document.createElement("dt");
      dt.className = "font-mono text-xs text-destructive break-words";
      dt.textContent = path;
      row.appendChild(dt);
      const dd = document.createElement("dd");
      dd.className = "mt-1 text-sm text-foreground/85";
      dd.textContent = msgs.join(" · ");
      row.appendChild(dd);
      list.appendChild(row);
    }
    block.appendChild(list);
    wrap.appendChild(block);
  }

  container.appendChild(wrap);
  container.hidden = false;
}
