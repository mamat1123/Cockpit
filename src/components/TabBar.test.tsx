// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TabBar } from "./TabBar";
import { initLayout, reduce, type Layout } from "../layout/paneLayout";

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function baseProps(layout: Layout) {
  return {
    layout,
    attention: new Set<string>(),
    unseenByTab: new Map<string, number>(),
    bellOpen: false,
    viewMode: "tabs" as const,
    onSetViewMode: () => {},
    onToggleBell: () => {},
    onJumpSession: () => {},
    onSelect: () => {},
    onNewTab: () => {},
    onReorder: () => {},
    onRenameTab: vi.fn(),
    onCloseTab: vi.fn(),
    onOpenDashboard: () => {},
    onOpenPicker: () => {},
    onOpenWorkspaces: () => {},
    onOpenSettings: () => {},
  };
}

// Shared across every describe block below — each test gets a fresh mount/unmount.
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});
function mount(layout: Layout, overrides: Partial<ReturnType<typeof baseProps>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props = { ...baseProps(layout), ...overrides };
  act(() => root!.render(<TabBar {...props} />));
  return { container, props };
}

describe("TabBar — rename", () => {
  it("double-clicking the title swaps it for an input, focused with its text selected", () => {
    const layout = initLayout("/tmp/proj");
    const { container } = mount(layout);
    const title = container.querySelector(".cockpit-tab__title")!;
    act(() => title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = container.querySelector(".cockpit-tab__input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("proj");
  });

  it("Enter commits the new title via onRenameTab", () => {
    const layout = initLayout("/tmp/proj");
    const onRenameTab = vi.fn();
    const { container } = mount(layout, { onRenameTab });
    const title = container.querySelector(".cockpit-tab__title")!;
    act(() => title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = container.querySelector(".cockpit-tab__input") as HTMLInputElement;
    act(() => typeInto(input, "frontend"));
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onRenameTab).toHaveBeenCalledWith(layout.tabs[0].id, "frontend");
    expect(container.querySelector(".cockpit-tab__input")).toBeNull();
  });

  it("Escape cancels without calling onRenameTab", () => {
    const layout = initLayout("/tmp/proj");
    const onRenameTab = vi.fn();
    const { container } = mount(layout, { onRenameTab });
    const title = container.querySelector(".cockpit-tab__title")!;
    act(() => title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = container.querySelector(".cockpit-tab__input") as HTMLInputElement;
    act(() => typeInto(input, "discard me"));
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onRenameTab).not.toHaveBeenCalled();
    expect(container.querySelector(".cockpit-tab__input")).toBeNull();
    expect(container.querySelector(".cockpit-tab__title")!.textContent).toBe("proj");
  });

  it("seeds the draft from the raw title, not the truncated 24-char display string", () => {
    const longTitle = "This Is A Really Long Tab Title"; // > 24 chars, would otherwise be truncated with "…"
    let layout = initLayout("/tmp/proj");
    layout = reduce(layout, { type: "renameTab", tabId: layout.tabs[0].id, title: longTitle });
    const { container } = mount(layout);
    const title = container.querySelector(".cockpit-tab__title")!;
    act(() => title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = container.querySelector(".cockpit-tab__input") as HTMLInputElement;
    expect(input.value).toBe(longTitle);
  });

  it("does not swallow a Space keystroke typed inside the rename input", () => {
    const layout = initLayout("/tmp/proj");
    const { container } = mount(layout);
    const title = container.querySelector(".cockpit-tab__title")!;
    act(() => title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = container.querySelector(".cockpit-tab__input") as HTMLInputElement;
    const evt = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    act(() => input.dispatchEvent(evt));
    expect(evt.defaultPrevented).toBe(false);
  });

  it("Enter inside the rename input does not redundantly re-fire onSelect via the outer div", () => {
    const layout = initLayout("/tmp/proj");
    const onSelect = vi.fn();
    const { container } = mount(layout, { onSelect });
    const title = container.querySelector(".cockpit-tab__title")!;
    act(() => title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = container.querySelector(".cockpit-tab__input") as HTMLInputElement;
    const callsBefore = onSelect.mock.calls.length;
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSelect.mock.calls.length).toBe(callsBefore);
  });
});

describe("TabBar — close", () => {
  it("clicking × on a 1-pane tab closes it immediately", () => {
    const layout = initLayout("/tmp/proj");
    const onCloseTab = vi.fn();
    const { container } = mount(layout, { onCloseTab });
    const x = container.querySelector(".cockpit-tab__x") as HTMLButtonElement;
    act(() => x.click());
    expect(onCloseTab).toHaveBeenCalledWith(layout.tabs[0].id);
    expect(container.querySelector(".confirm-chip")).toBeNull();
  });

  it("clicking × on a >1-pane tab shows a confirm chip instead of closing", () => {
    const layout = reduce(initLayout("/tmp/proj"), { type: "split" });
    const onCloseTab = vi.fn();
    const { container } = mount(layout, { onCloseTab });
    const x = container.querySelector(".cockpit-tab__x") as HTMLButtonElement;
    act(() => x.click());
    expect(onCloseTab).not.toHaveBeenCalled();
    expect(container.querySelector(".confirm-chip")!.textContent).toContain("Close 2 sessions?");
  });

  it("Cancel in the confirm chip dismisses it without closing", () => {
    const layout = reduce(initLayout("/tmp/proj"), { type: "split" });
    const onCloseTab = vi.fn();
    const { container } = mount(layout, { onCloseTab });
    act(() => (container.querySelector(".cockpit-tab__x") as HTMLButtonElement).click());
    act(() => (container.querySelector(".confirm-chip__cancel") as HTMLButtonElement).click());
    expect(onCloseTab).not.toHaveBeenCalled();
    expect(container.querySelector(".confirm-chip")).toBeNull();
  });

  it("Close in the confirm chip calls onCloseTab", () => {
    const layout = reduce(initLayout("/tmp/proj"), { type: "split" });
    const onCloseTab = vi.fn();
    const { container } = mount(layout, { onCloseTab });
    act(() => (container.querySelector(".cockpit-tab__x") as HTMLButtonElement).click());
    act(() => (container.querySelector(".confirm-chip__go") as HTMLButtonElement).click());
    expect(onCloseTab).toHaveBeenCalledWith(layout.tabs[0].id);
  });

  it("clicking outside the confirm chip dismisses it", () => {
    const layout = reduce(initLayout("/tmp/proj"), { type: "split" });
    const { container } = mount(layout);
    act(() => (container.querySelector(".cockpit-tab__x") as HTMLButtonElement).click());
    expect(container.querySelector(".confirm-chip")).not.toBeNull();
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(container.querySelector(".confirm-chip")).toBeNull();
  });
});
