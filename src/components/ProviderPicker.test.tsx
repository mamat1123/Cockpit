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
