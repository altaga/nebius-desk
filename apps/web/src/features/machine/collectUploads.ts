/** Collect desktop files/folders from a picker or drag-and-drop into relative paths. */

export type UploadItem =
  | { relativePath: string; file: File }
  | { relativePath: string; kind: "dir" };

/** Must stay under cloud relay MAX_REQUEST_BODY after base64 (~4/3) + JSON wrapper. */
export const MAX_UPLOAD_BYTES = 1_500_000;

type DirReader = {
  readEntries: (ok: (entries: FileSystemEntryLike[]) => void, err?: (error: DOMException) => void) => void;
};

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (ok: (file: File) => void, err?: (error: DOMException) => void) => void;
  createReader?: () => DirReader;
};

function cleanRel(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function joinRel(base: string, leaf: string) {
  const left = cleanRel(base);
  const right = cleanRel(leaf);
  if (!left) return right;
  if (!right) return left;
  return `${left}/${right}`;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.onload = () => {
      const raw = String(reader.result || "");
      const comma = raw.indexOf(",");
      resolve(comma >= 0 ? raw.slice(comma + 1) : raw);
    };
    reader.readAsDataURL(file);
  });
}

export function validateUploadSize(item: UploadItem) {
  if (!("file" in item)) return null;
  if (item.file.size > MAX_UPLOAD_BYTES) {
    const mb = (MAX_UPLOAD_BYTES / 1_000_000).toFixed(1);
    return `"${item.file.name}" is too large (max ${mb} MB over the board link)`;
  }
  return null;
}

/** File picker: plain files use their name; folder picker uses webkitRelativePath. */
export function itemsFromFileList(list: FileList | File[]): UploadItem[] {
  const files = Array.from(list);
  return files
    .map((file) => {
      const relative =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath?.trim() || file.name;
      return { relativePath: cleanRel(relative), file };
    })
    .filter((item) => item.relativePath && !item.relativePath.endsWith("/"));
}

async function readAllEntries(reader: DirReader) {
  const out: FileSystemEntryLike[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch.length) break;
    out.push(...batch);
  }
  return out;
}

async function walkEntry(entry: FileSystemEntryLike, prefix: string, out: UploadItem[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
    out.push({ relativePath: joinRel(prefix, entry.name), file });
    return;
  }
  if (!entry.isDirectory || !entry.createReader) return;
  const reader = entry.createReader();
  const children = await readAllEntries(reader);
  const next = joinRel(prefix, entry.name);
  if (children.length === 0) {
    out.push({ relativePath: next, kind: "dir" });
    return;
  }
  for (const child of children) {
    await walkEntry(child, next, out);
  }
}

/** Drag-and-drop: walk FileSystemEntry tree so folders keep structure under the open dir. */
export async function itemsFromDataTransfer(data: DataTransfer): Promise<UploadItem[]> {
  const items = Array.from(data.items || []);
  const out: UploadItem[] = [];
  let usedEntries = false;

  for (const item of items) {
    if (item.kind !== "file") continue;
    const entry = (
      item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }
    ).webkitGetAsEntry?.();
    if (entry) {
      usedEntries = true;
      await walkEntry(entry, "", out);
      continue;
    }
  }

  if (!usedEntries || out.length === 0) {
    return itemsFromFileList(data.files);
  }
  return out;
}

export function hasFileDrag(data: DataTransfer | null | undefined) {
  if (!data?.types) return false;
  return Array.from(data.types).includes("Files");
}
