// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TabBar } from "./TabBar";
import { initLayout, type Layout } from "../layout/paneLayout";

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
    onToggleBell: () => {},
    onJumpSession: () => {},
    onSelect: () => {},
    onNewTab: () => {},
    onReorder: () => {},
    onRenameTab: vi.fn(),
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
});
