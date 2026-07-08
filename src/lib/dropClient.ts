import { invoke } from "@tauri-apps/api/core";

/** Read a dropped File as base64 (without the `data:...;base64,` prefix). A Tauri
 *  WKWebView never exposes the original filesystem path of an HTML5-dropped file,
 *  so we ship the raw bytes to Rust, which writes a temp file we can hand to claude. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = () => reject(r.error ?? new Error("FileReader failed"));
    r.readAsDataURL(file);
  });
}

/** Persist a dropped file to a temp path via Rust and return its absolute path. */
export async function saveDroppedFile(file: File): Promise<string> {
  const dataB64 = await readAsBase64(file);
  return invoke<string>("save_dropped_file", { name: file.name, dataB64 });
}

/** True when a drag carries OS files (vs. an internal pane-reorder drag, which
 *  uses `text/plain`). Works during `dragover` too, where `files` is still empty
 *  but `types` already lists "Files". */
export function dragHasFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes("Files");
}

/** Every dropped file. We persist each to a temp path and insert that path into
 *  the pane's PTY. claude renders an image path as an `[Image #N]` chip, and
 *  inserts any other path (pdf, code, docs) as literal text it reads on submit —
 *  so we no longer filter to images. A temp copy is fine for both: claude only
 *  reads the file's content. (It is NOT the original repo file, so claude can't
 *  edit it in place — that would need the real path via native drag-drop.) */
export function droppableFiles(list: FileList): File[] {
  return Array.from(list);
}
