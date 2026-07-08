import { describe, it, expect } from "vitest";
import { droppableFiles, dragHasFiles } from "./dropClient";

const file = (name: string, type = ""): File => ({ name, type }) as unknown as File;
const asList = (...fs: File[]): FileList => fs as unknown as FileList;

describe("droppableFiles", () => {
  it("keeps non-image files (pdf, code, docs) so their path can be inserted", () => {
    const list = asList(
      file("report.pdf", "application/pdf"),
      file("TerminalPane.tsx", ""),
      file("notes.md", "text/markdown"),
    );
    expect(droppableFiles(list).map((f) => f.name)).toEqual([
      "report.pdf",
      "TerminalPane.tsx",
      "notes.md",
    ]);
  });

  it("still keeps image files (which claude renders as an [Image #N] chip)", () => {
    const list = asList(file("shot.png", "image/png"), file("pic.jpg", "image/jpeg"));
    expect(droppableFiles(list).map((f) => f.name)).toEqual(["shot.png", "pic.jpg"]);
  });

  it("returns every dropped file, mixed types included", () => {
    const list = asList(file("a.png", "image/png"), file("b.zip", "application/zip"));
    expect(droppableFiles(list)).toHaveLength(2);
  });
});

describe("dragHasFiles", () => {
  it("true when the drag carries OS files", () => {
    expect(dragHasFiles({ types: ["Files"] } as unknown as DataTransfer)).toBe(true);
  });

  it("false for an internal pane-reorder drag (text/plain only)", () => {
    expect(dragHasFiles({ types: ["text/plain"] } as unknown as DataTransfer)).toBe(false);
  });

  it("false when there is no dataTransfer", () => {
    expect(dragHasFiles(null)).toBe(false);
  });
});
