# Provider Picker + Real Provider Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the letter-mark provider badges with real Claude/Codex/Z.ai icons, and add a
modal that asks which provider to use whenever a new session or a new pane is created.

**Architecture:** New icon components render real brand SVGs (`fill="currentColor"`, drop-in
replacements for the existing `{meta.mark}` letter). A new `ProviderPicker` modal (hand-rolled
overlay, same pattern as the existing `ProjectPicker`) is inserted between the two existing
pane-creation triggers — `ProjectPicker.onPick` (⌘T/⌘O, new session) and the ⌘D/⌘⇧D keybinding
(new pane/split) — and the `paneLayout` reducer, so `newTab`/`split`/`splitDown` now carry an
explicit `provider` through to the `Pane` they create, instead of creating it unset (implicit
Claude) and relying on the post-creation switcher.

**Tech Stack:** React 19, TypeScript 5.8 (strict), Vite 7, vitest + jsdom for tests. No new
dependencies. No Rust/Tauri changes.

## Global Constraints

- No new npm dependencies — the picker is a hand-rolled overlay matching `ProjectPicker.tsx`'s
  existing pattern, not a component library.
- Z.ai stays `enabled: false` in `src/lib/providers.ts` — this plan does not wire an actual Z.ai
  launch (`terminalRegistry.ts`'s `"z.ai provider is not wired yet"` stub is untouched). Z.ai
  appears in the new picker as a visibly disabled card only.
- `provider` fields added to the `newTab`/`split`/`splitDown` actions must be **optional** —
  existing call sites (tests, the ⌘T fallback path used when no handler is wired) pass no
  provider today and must keep working unchanged.
- Icon path data is sourced already (see spec) — use it verbatim, do not re-derive or
  approximate it.
- Clicking an enabled provider card confirms immediately (no separate "select then confirm"
  step) — matches how `PaneHeader`'s existing provider dropdown already behaves.

---

## Task 1: Provider icon components

**Files:**
- Create: `src/components/icons/ProviderIcons.tsx`
- Test: `src/components/icons/ProviderIcons.test.tsx`

**Interfaces:**
- Produces: `ClaudeIcon`, `CodexIcon`, `ZaiIcon` — each `(props: SVGProps<SVGSVGElement>) => JSX.Element`.
- Produces: `ProviderIcon({ id, ...props }: { id: AgentProvider } & SVGProps<SVGSVGElement>) => JSX.Element` —
  the dispatcher every later task renders instead of a letter.

- [ ] **Step 1: Write the failing test**

Create `src/components/icons/ProviderIcons.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ProviderIcon } from "./ProviderIcons";

describe("ProviderIcon", () => {
  it("renders the right icon per provider id", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<ProviderIcon id="claude" />));
    expect(container.querySelector("svg title")?.textContent).toBe("Claude");
    act(() => root.render(<ProviderIcon id="codex" />));
    expect(container.querySelector("svg title")?.textContent).toBe("Codex");
    act(() => root.render(<ProviderIcon id="zai" />));
    expect(container.querySelector("svg title")?.textContent).toBe("Z.ai");
    act(() => root.unmount());
    container.remove();
  });

  it("forwards extra props (e.g. className) to the underlying svg", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<ProviderIcon id="claude" className="my-icon" />));
    expect(container.querySelector("svg")?.getAttribute("class")).toBe("my-icon");
    act(() => root.unmount());
    container.remove();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/icons/ProviderIcons.test.tsx`
Expected: FAIL — `Failed to resolve import "./ProviderIcons"` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/components/icons/ProviderIcons.tsx`:

```tsx
import type { SVGProps } from "react";
import type { AgentProvider } from "../../layout/paneLayout";

export function ClaudeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <title>Claude</title>
      <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
    </svg>
  );
}

export function CodexIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <title>Codex</title>
      <path fillRule="evenodd" clipRule="evenodd" d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z" />
    </svg>
  );
}

export function ZaiIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <title>Z.ai</title>
      <path d="M12.105 2L9.927 4.953H.653L2.83 2h9.276zM23.254 19.048L21.078 22h-9.242l2.174-2.952h9.244zM24 2L9.264 22H0L14.736 2H24z" />
    </svg>
  );
}

const ICONS: Record<AgentProvider, (props: SVGProps<SVGSVGElement>) => JSX.Element> = {
  claude: ClaudeIcon,
  codex: CodexIcon,
  zai: ZaiIcon,
};

export function ProviderIcon({ id, ...props }: { id: AgentProvider } & SVGProps<SVGSVGElement>) {
  const Icon = ICONS[id];
  return <Icon {...props} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/icons/ProviderIcons.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/icons/ProviderIcons.tsx src/components/icons/ProviderIcons.test.tsx
git commit -m "feat: add real Claude/Codex/Z.ai icon components"
```

---

## Task 2: Swap the letter badges for icons in UsageGauges

**Files:**
- Modify: `src/components/UsageGauges.tsx` (4 call sites)
- Modify: `src/components/UsageGauges.css`

**Interfaces:**
- Consumes: `ProviderIcon({ id })` from Task 1 (`../components/icons/ProviderIcons` relative to
  `UsageGauges.tsx` is `./icons/ProviderIcons`).

- [ ] **Step 1: Add the import**

In `src/components/UsageGauges.tsx`, add to the top imports (after the existing `providerMeta`
import on line 7):

```ts
import { ProviderIcon } from "./icons/ProviderIcons";
```

- [ ] **Step 2: Replace all 4 badge render sites**

The exact same JSX fragment appears 4 times in `src/components/UsageGauges.tsx` (lines 169, 199,
207, 225) — inside `ProviderGaugeGroup`, and three times inside `MiniProviderRow`'s loading/na/data
branches. Replace every occurrence of:

```tsx
<span className={`cu-badge provider-${id}`}>{meta.mark}</span>
```

with:

```tsx
<span className={`cu-badge provider-${id}`}><ProviderIcon id={id} /></span>
```

(All 4 sites use the same `id` variable name in scope, so this is a safe find-and-replace-all
within the file.)

- [ ] **Step 3: Size the icon inside the existing badge box**

In `src/components/UsageGauges.css`, add right after the existing `.cu-badge` rule (after line 54,
`border: 1px solid currentColor; ...`):

```css
.cu-badge svg { width: 10px; height: 10px; fill: currentColor; }
```

- [ ] **Step 4: Update the existing render tests to assert icons instead of letters**

`src/components/UsageGauges.popover.test.tsx` doesn't currently assert on badge content, so no
change is required there. Confirm this by running it:

Run: `npx vitest run src/components/UsageGauges.popover.test.tsx src/components/UsageGauges.panel.test.tsx`
Expected: PASS (both files, unchanged) — confirms the icon swap didn't break existing badge/popover
behavior.

- [ ] **Step 5: Manual visual check**

Run: `npm run dev`
Open the app, look at the tab-bar usage strip and Mission Control panel. Expected: Claude, Codex,
and Z.ai badges show their real marks (not `C`/`X`/`Z` letters), still colored per-theme exactly
as before.

- [ ] **Step 6: Commit**

```bash
git add src/components/UsageGauges.tsx src/components/UsageGauges.css
git commit -m "feat: show real provider icons in usage gauge badges"
```

---

## Task 3: Swap the letter badges for icons in PaneHeader

**Files:**
- Modify: `src/components/PaneHeader.tsx` (2 call sites)
- Modify: `src/components/PaneHeader.css`

**Interfaces:**
- Consumes: `ProviderIcon({ id })` from Task 1.

- [ ] **Step 1: Add the import**

In `src/components/PaneHeader.tsx`, add to the top imports (after the existing `providers` import
on line 5):

```ts
import { ProviderIcon } from "./icons/ProviderIcons";
```

- [ ] **Step 2: Replace the active-provider badge**

Replace (line 102):

```tsx
<span className="pane-head__provider-mark">{activeProvider.mark}</span>
```

with:

```tsx
<span className="pane-head__provider-mark"><ProviderIcon id={provider} /></span>
```

- [ ] **Step 3: Replace the dropdown list item badge**

Replace (line 120):

```tsx
<span className="pane-head__provider-item-mark">{p.mark}</span>
```

with:

```tsx
<span className="pane-head__provider-item-mark"><ProviderIcon id={p.id} /></span>
```

- [ ] **Step 4: Size the icons inside the existing badge circles**

In `src/components/PaneHeader.css`, add right after the `.pane-head__provider-mark` rule (after
line 33):

```css
.pane-head__provider-mark svg { width: 9px; height: 9px; fill: currentColor; }
```

And right after the `.pane-head__provider-item-mark` rule (after line 46):

```css
.pane-head__provider-item-mark svg { width: 12px; height: 12px; fill: currentColor; }
```

- [ ] **Step 5: Manual visual check**

Run: `npm run dev`
Open a pane, click its provider badge to open the dropdown. Expected: the active badge and every
dropdown row show real icons, Z.ai's row is still visibly disabled ("coming soon"), switching
Claude→Codex still works exactly as before (handoff flow untouched).

- [ ] **Step 6: Commit**

```bash
git add src/components/PaneHeader.tsx src/components/PaneHeader.css
git commit -m "feat: show real provider icons in the pane-header provider control"
```

---

## Task 4: Thread `provider` through newTab/split/splitDown

**Files:**
- Modify: `src/layout/paneLayout.ts`
- Test: `src/layout/paneLayout.test.ts`

**Interfaces:**
- Produces: `Action` variants `{ type: "newTab"; cwd?: string; provider?: AgentProvider }`,
  `{ type: "split"; provider?: AgentProvider }`, `{ type: "splitDown"; provider?: AgentProvider }` —
  Task 6 dispatches these with a real `provider`.
- Produces: `makePane(cwd: string, provider?: AgentProvider): Pane`, `makeRow(cwd: string,
  provider?: AgentProvider): Row` (both already existed, gain a second optional param — not
  exported, used only inside this file, but noted since the reducer cases below call them).

- [ ] **Step 1: Write the failing tests**

Append to `src/layout/paneLayout.test.ts` (it already imports `reduce`, `initLayout`, `Layout`, and
defines `CWD`/`panesOf` at the top — reuse those, don't redefine):

```ts
describe("provider selection on creation", () => {
  it("newTab creates its pane with the given provider", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "newTab", cwd: CWD, provider: "codex" });
    expect(panesOf(l, 1)[0].provider).toBe("codex");
  });

  it("split creates its new pane with the given provider", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split", provider: "codex" });
    expect(panesOf(l)[1].provider).toBe("codex");
  });

  it("splitDown creates its new pane with the given provider", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "splitDown", provider: "codex" });
    expect(l.tabs[0].rows[1].panes[0].provider).toBe("codex");
  });

  it("omitting provider on split leaves it unset, same as before this feature", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split" });
    expect(panesOf(l)[1].provider).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/layout/paneLayout.test.ts`
Expected: FAIL on the first 3 new tests — `provider` comes back `undefined` instead of `"codex"`
(the 4th new test already passes, since that's today's behavior).

- [ ] **Step 3: Implement — widen the Action type**

In `src/layout/paneLayout.ts`, replace (lines 29-31):

```ts
  | { type: "newTab"; cwd?: string }
  | { type: "split" }       // split right: add a column in the focused pane's row
  | { type: "splitDown" }   // split down: add a new row after the focused pane's row
```

with:

```ts
  | { type: "newTab"; cwd?: string; provider?: AgentProvider }
  | { type: "split"; provider?: AgentProvider }       // split right: add a column in the focused pane's row
  | { type: "splitDown"; provider?: AgentProvider }   // split down: add a new row after the focused pane's row
```

- [ ] **Step 4: Implement — thread provider through makePane/makeRow**

Replace (line 52-53):

```ts
const makePane = (cwd: string): Pane => ({ id: nextId("pane"), cwd, size: 1, title: defaultTitle(cwd), autoTitle: true, sessionId: crypto.randomUUID() });
const makeRow = (cwd: string): Row => ({ id: nextId("row"), panes: [makePane(cwd)], size: 1 });
```

with:

```ts
const makePane = (cwd: string, provider?: AgentProvider): Pane => ({ id: nextId("pane"), cwd, size: 1, title: defaultTitle(cwd), autoTitle: true, sessionId: crypto.randomUUID(), provider });
const makeRow = (cwd: string, provider?: AgentProvider): Row => ({ id: nextId("row"), panes: [makePane(cwd, provider)], size: 1 });
```

- [ ] **Step 5: Implement — pass provider through in the three reducer cases**

In the `case "newTab":` block, replace:

```ts
      const row = makeRow(cwd);
```

with:

```ts
      const row = makeRow(cwd, a.provider);
```

In the `case "split":` block, replace:

```ts
      const pane = makePane(focusedCwd(l));
```

with:

```ts
      const pane = makePane(focusedCwd(l), a.provider);
```

In the `case "splitDown":` block, replace:

```ts
      const row = makeRow(focusedCwd(l));
```

with:

```ts
      const row = makeRow(focusedCwd(l), a.provider);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/layout/paneLayout.test.ts`
Expected: PASS (all tests, including the pre-existing ones — provider is optional so no existing
call site breaks).

- [ ] **Step 7: Run the full test suite as a regression check**

Run: `npm test`
Expected: PASS — no other file reduces on `newTab`/`split`/`splitDown` in a way `provider` could
break (it's purely additive/optional).

- [ ] **Step 8: Commit**

```bash
git add src/layout/paneLayout.ts src/layout/paneLayout.test.ts
git commit -m "feat: let newTab/split/splitDown create a pane with an explicit provider"
```

---

## Task 5: `ProviderPicker` modal component

**Files:**
- Create: `src/components/ProviderPicker.tsx`
- Create: `src/components/ProviderPicker.css`
- Test: `src/components/ProviderPicker.test.tsx`

**Interfaces:**
- Consumes: `PROVIDERS` from `../lib/providers` (Task 1's `ProviderIcon` from `./icons/ProviderIcons`).
- Produces: `ProviderPickerContext = { kind: "newTab"; cwd: string } | { kind: "split" } | { kind:
  "splitDown" }` and `ProviderPicker({ context, onPick, onCancel }: { context:
  ProviderPickerContext; onPick: (provider: AgentProvider) => void; onCancel: () => void })` — Task
  6 renders this and wires `onPick`/`onCancel` to `dispatch`/closing the modal.

- [ ] **Step 1: Write the failing tests**

Create `src/components/ProviderPicker.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AgentProvider } from "../layout/paneLayout";
import { ProviderPicker } from "./ProviderPicker";

describe("ProviderPicker", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  function mount(onPick: (p: AgentProvider) => void, onCancel: () => void) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<ProviderPicker context={{ kind: "split" }} onPick={onPick} onCancel={onCancel} />);
    });
    return container;
  }

  it("renders one card per provider, Z.ai disabled", () => {
    const c = mount(() => {}, () => {});
    const cards = Array.from(c.querySelectorAll(".provider-picker__card")) as HTMLButtonElement[];
    expect(cards).toHaveLength(3);
    expect(cards[0].disabled).toBe(false); // claude
    expect(cards[1].disabled).toBe(false); // codex
    expect(cards[2].disabled).toBe(true);  // zai
  });

  it("clicking an enabled card confirms it immediately", () => {
    const onPick = vi.fn();
    const c = mount(onPick, () => {});
    const cards = Array.from(c.querySelectorAll(".provider-picker__card")) as HTMLButtonElement[];
    act(() => cards[1].click());
    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledWith("codex");
  });

  it("clicking the disabled Z.ai card does nothing", () => {
    const onPick = vi.fn();
    const c = mount(onPick, () => {});
    const cards = Array.from(c.querySelectorAll(".provider-picker__card")) as HTMLButtonElement[];
    act(() => cards[2].click());
    expect(onPick).not.toHaveBeenCalled();
  });

  it("Escape cancels without picking", () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    const c = mount(onPick, onCancel);
    const panel = c.querySelector(".provider-picker__panel") as HTMLElement;
    act(() => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("pressing 2 confirms Codex directly", () => {
    const onPick = vi.fn();
    const c = mount(onPick, () => {});
    const panel = c.querySelector(".provider-picker__panel") as HTMLElement;
    act(() => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true })));
    expect(onPick).toHaveBeenCalledWith("codex");
  });

  it("backdrop click cancels", () => {
    const onCancel = vi.fn();
    const c = mount(() => {}, onCancel);
    const backdrop = c.querySelector(".provider-picker") as HTMLElement;
    act(() => backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/ProviderPicker.test.tsx`
Expected: FAIL — `Failed to resolve import "./ProviderPicker"` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/components/ProviderPicker.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { AgentProvider } from "../layout/paneLayout";
import { PROVIDERS } from "../lib/providers";
import { ProviderIcon } from "./icons/ProviderIcons";
import "./ProviderPicker.css";

export type ProviderPickerContext =
  | { kind: "newTab"; cwd: string }
  | { kind: "split" }
  | { kind: "splitDown" };

function hintFor(context: ProviderPickerContext): string {
  if (context.kind === "newTab") return `New tab · ${context.cwd}`;
  if (context.kind === "split") return "Split pane →";
  return "Split pane ↓";
}

export function ProviderPicker({ context, onPick, onCancel }: {
  context: ProviderPickerContext;
  onPick: (provider: AgentProvider) => void;
  onCancel: () => void;
}) {
  const enabled = PROVIDERS.filter((p) => p.enabled);
  const [focusIdx, setFocusIdx] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { panelRef.current?.focus(); }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); setFocusIdx((i) => Math.min(i + 1, enabled.length - 1)); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); setFocusIdx((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter") { e.preventDefault(); onPick(enabled[focusIdx].id); return; }
    const n = Number(e.key);
    if (n >= 1 && n <= enabled.length) { e.preventDefault(); setFocusIdx(n - 1); onPick(enabled[n - 1].id); }
  };

  return (
    <div className="provider-picker" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div
        className="provider-picker__panel"
        role="dialog"
        aria-label="Start with which provider?"
        tabIndex={-1}
        ref={panelRef}
        onKeyDown={onKeyDown}
      >
        <p className="provider-picker__title">Start with which provider?</p>
        <p className="provider-picker__hint">{hintFor(context)}</p>
        <div className="provider-picker__row">
          {PROVIDERS.map((p) => {
            const idx = enabled.findIndex((ep) => ep.id === p.id);
            const isFocused = p.enabled && idx === focusIdx;
            return (
              <button
                key={p.id}
                type="button"
                className={`provider-picker__card provider-${p.id}${isFocused ? " is-focused" : ""}`}
                disabled={!p.enabled}
                onClick={() => { if (p.enabled) onPick(p.id); }}
                onMouseEnter={() => { if (p.enabled) setFocusIdx(idx); }}
              >
                <span className="provider-picker__mark"><ProviderIcon id={p.id} /></span>
                <span className="provider-picker__label">{p.label}</span>
                {p.enabled ? (
                  <span className="provider-picker__key">{idx + 1}</span>
                ) : (
                  <span className="provider-picker__soon">Soon</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="provider-picker__foot">
          <span>← → select · enter confirm</span>
          <span>esc cancel</span>
        </div>
      </div>
    </div>
  );
}
```

Create `src/components/ProviderPicker.css`:

```css
.provider-picker { position: fixed; inset: 0; z-index: 60; background: rgba(8,9,12,.6); backdrop-filter: blur(3px);
  display: flex; justify-content: center; align-items: center; animation: provider-picker-in .12s ease; }
@keyframes provider-picker-in { from { opacity: 0; } to { opacity: 1; } }
.provider-picker__panel { width: min(360px, 92vw); background: var(--ck-bg); border: 1px solid var(--ck-surface-2);
  border-radius: 14px; box-shadow: 0 24px 60px -12px rgba(0,0,0,.6); padding: 18px;
  font-family: ui-monospace, Menlo, monospace; outline: none; }
.provider-picker__title { color: var(--ck-bright); font-size: 13px; font-weight: 700; margin: 0 0 2px; }
.provider-picker__hint { color: var(--ck-muted); font-size: 11px; margin: 0 0 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.provider-picker__row { display: flex; gap: 8px; }
.provider-picker__card { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px;
  background: var(--ck-surface); border: 1px solid var(--ck-border); border-radius: 9px; padding: 12px 8px;
  color: var(--ck-text); font: inherit; cursor: pointer; position: relative; transition: border-color .12s, box-shadow .12s; }
.provider-picker__card:hover:not(:disabled) { border-color: var(--ck-dim); }
.provider-picker__card:disabled { opacity: .45; cursor: not-allowed; }
.provider-picker__card.provider-claude.is-focused { border-color: var(--ck-accent); box-shadow: 0 0 0 1px var(--ck-accent), 0 0 14px -4px var(--ck-accent); }
.provider-picker__card.provider-codex.is-focused { border-color: var(--ck-blue); box-shadow: 0 0 0 1px var(--ck-blue), 0 0 14px -4px var(--ck-blue); }
.provider-picker__card.provider-claude .provider-picker__mark { color: var(--ck-accent); }
.provider-picker__card.provider-codex .provider-picker__mark { color: var(--ck-blue); }
.provider-picker__card.provider-zai .provider-picker__mark { color: var(--ck-magenta); }
.provider-picker__mark { width: 26px; height: 26px; border-radius: 7px; display: flex; align-items: center; justify-content: center;
  border: 1.5px solid currentColor; }
.provider-picker__mark svg { width: 14px; height: 14px; fill: currentColor; }
.provider-picker__label { font-size: 11.5px; font-weight: 700; color: var(--ck-bright); }
.provider-picker__key { position: absolute; top: 5px; right: 6px; font-size: 9px; color: var(--ck-dim);
  border: 1px solid var(--ck-border); border-radius: 4px; padding: 1px 5px; }
.provider-picker__soon { position: absolute; top: 5px; right: 6px; font-size: 8px; text-transform: uppercase;
  letter-spacing: .06em; color: var(--ck-magenta); border: 1px solid var(--ck-magenta); border-radius: 4px; padding: 1px 5px; }
.provider-picker__foot { display: flex; justify-content: space-between; margin-top: 14px; padding-top: 10px;
  border-top: 1px solid var(--ck-border); font-size: 10px; color: var(--ck-dim); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/ProviderPicker.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/ProviderPicker.tsx src/components/ProviderPicker.css src/components/ProviderPicker.test.tsx
git commit -m "feat: add ProviderPicker modal"
```

---

## Task 6: Wire the picker into new-tab and split/splitDown

**Files:**
- Modify: `src/layout/useKeybindings.ts`
- Modify: `src/components/CockpitView.tsx`

**Interfaces:**
- Consumes: `ProviderPicker`, `ProviderPickerContext` from Task 5; the `provider`-carrying
  `newTab`/`split`/`splitDown` actions from Task 4.

- [ ] **Step 1: Add an `onSplit` escape hatch to useKeybindings**

In `src/layout/useKeybindings.ts`, replace the opts type (line 7):

```ts
  opts: { onNewTab?: () => void; onToggleDashboard?: () => void; onOpenProject?: () => void; onOpenWorkspaces?: () => void; onOpenSettings?: () => void; onToggleBell?: () => void } = {},
```

with:

```ts
  opts: { onNewTab?: () => void; onSplit?: (down: boolean) => void; onToggleDashboard?: () => void; onOpenProject?: () => void; onOpenWorkspaces?: () => void; onOpenSettings?: () => void; onToggleBell?: () => void } = {},
```

Replace the `d` handler (line 16):

```ts
      else if (k === "d") { e.preventDefault(); dispatch({ type: e.shiftKey ? "splitDown" : "split" }); }
```

with:

```ts
      else if (k === "d") { e.preventDefault(); if (opts.onSplit) opts.onSplit(e.shiftKey); else dispatch({ type: e.shiftKey ? "splitDown" : "split" }); }
```

Add `opts.onSplit` to the effect's dependency array (line 26):

```ts
  }, [dispatch, opts.onNewTab, opts.onSplit, opts.onToggleDashboard, opts.onOpenProject, opts.onOpenWorkspaces, opts.onOpenSettings, opts.onToggleBell]);
```

- [ ] **Step 2: Run the existing keybindings-adjacent tests as a sanity check**

Run: `npm test`
Expected: PASS — `useKeybindings` has no dedicated test file today (confirmed: only
`paneLayout.test.ts`, `paneHost.test.ts`, etc. reference layout/dispatch), so this step only
guards against an unrelated regression elsewhere.

- [ ] **Step 3: Add pending-creation state and render the picker in CockpitView**

In `src/components/CockpitView.tsx`, add the import (after the existing `ProjectPicker` import on
line 12):

```ts
import { ProviderPicker, type ProviderPickerContext } from "./ProviderPicker";
```

Add new state next to the other modal-visibility state (after `pickerOpen` on line 64):

```ts
  const [pendingCreation, setPendingCreation] = useState<ProviderPickerContext | null>(null);
```

Replace the `useKeybindings` call (line 89):

```ts
  useKeybindings(dispatch, { onNewTab: () => setPickerOpen(true), onToggleDashboard: toggleDash, onOpenProject: () => setPickerOpen(true), onOpenWorkspaces: () => setWsOpen(true), onOpenSettings: () => setSettingsOpen(true), onToggleBell: () => setBellOpen((o) => !o) });
```

with:

```ts
  useKeybindings(dispatch, { onNewTab: () => setPickerOpen(true), onSplit: (down) => setPendingCreation(down ? { kind: "splitDown" } : { kind: "split" }), onToggleDashboard: toggleDash, onOpenProject: () => setPickerOpen(true), onOpenWorkspaces: () => setWsOpen(true), onOpenSettings: () => setSettingsOpen(true), onToggleBell: () => setBellOpen((o) => !o) });
```

Replace the `ProjectPicker`'s `onPick` (in the `{pickerOpen && (...)}` block, line 238):

```tsx
          onPick={(cwd) => { dispatch({ type: "newTab", cwd }); setPickerOpen(false); }}
```

with:

```tsx
          onPick={(cwd) => { setPickerOpen(false); setPendingCreation({ kind: "newTab", cwd }); }}
```

Add the picker's render block right after the `{pickerOpen && (...)}` block (after line 240,
before the `{wsOpen && (...)}` block):

```tsx
      {pendingCreation && (
        <ProviderPicker
          context={pendingCreation}
          onCancel={() => setPendingCreation(null)}
          onPick={(provider) => {
            if (pendingCreation.kind === "newTab") dispatch({ type: "newTab", cwd: pendingCreation.cwd, provider });
            else dispatch({ type: pendingCreation.kind, provider });
            setPendingCreation(null);
          }}
        />
      )}
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — no existing test drives `CockpitView` directly (it has no dedicated test file
today), so this confirms nothing else in the suite regressed.

- [ ] **Step 5: Manual end-to-end verification**

Run: `npm run dev`, then in the running app:

1. Press ⌘T (or ⌘O, or click the tab-strip `+`). Pick a folder in the `ProjectPicker`. Expected:
   the `ProjectPicker` closes and the new `ProviderPicker` modal opens immediately (not a new tab
   yet).
2. Click the Codex card. Expected: the modal closes and a new tab opens with a Codex pane (check
   its pane-header badge — should be Codex's icon, not Claude's).
3. With a pane focused, press ⌘D. Expected: the `ProviderPicker` opens (hint reads "Split pane
   →"). Press `1`. Expected: modal closes immediately, a new pane appears to the right, running
   Claude.
4. Press ⌘⇧D. Expected: the `ProviderPicker` opens (hint reads "Split pane ↓"). Press `Escape`.
   Expected: modal closes, **no new pane is created** (pane count unchanged).
5. Open the `ProviderPicker` again (⌘D) and click its dimmed Z.ai card. Expected: nothing happens
   (no modal close, no pane created) — matches the "disabled, unreachable" behavior from Task 5's
   tests.

- [ ] **Step 6: Commit**

```bash
git add src/layout/useKeybindings.ts src/components/CockpitView.tsx
git commit -m "feat: ask which provider to use when creating a new session or pane"
```

---

## Self-Review Notes

- **Spec coverage:** icon replacement (Task 1-3), picker component + behavior (Task 5), creation
  paths for both new session and new pane wired (Task 6), `provider` threaded through the data
  model (Task 4) — every in-scope item from the design spec has a task. Out-of-scope items (Z.ai
  launch wiring, handoff switcher, persisted default provider) are untouched by every task above —
  confirmed no task touches `terminalRegistry.ts`, `PaneHost.tsx`'s `onSelectProvider`, or
  `settings.ts`.
- **Placeholder scan:** no TBD/TODO; every step has complete, exact code or an exact command with
  its expected output.
- **Type consistency:** `ProviderPickerContext` (Task 5) is the exact shape Task 6's
  `pendingCreation` state uses and dispatches from; `ProviderIcon({ id })` (Task 1) is the exact
  signature Tasks 2, 3, and 5 all call.
