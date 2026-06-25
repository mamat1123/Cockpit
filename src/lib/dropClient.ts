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

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|heic|tiff?|avif)$/i;

/** Keep only image files — the drop-to-claude flow is for screenshots/images,
 *  for which a temp copy is semantically correct (claude just reads the pixels). */
export function imageFiles(list: FileList): File[] {
  return Array.from(list).filter((f) => f.type.startsWith("image/") || IMAGE_EXT.test(f.name));
}
