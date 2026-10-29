"use client";

import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDrag,
  type MouseEvent as ReactMouse,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  IconArrowUp,
  IconChevronRight,
  IconDots,
  IconFile,
  IconFolder,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUpload,
} from "@/ui/icons";
import { FileEditor } from "./FileEditor";
import { hasFileDrag, itemsFromDataTransfer, itemsFromFileList } from "./collectUploads";
import { crumbs, formatSize, useMachineFiles } from "./useMachineFiles";
import styles from "./FilesPane.module.css";

type Files = ReturnType<typeof useMachineFiles>;
type Kind = "file" | "dir";
type Point = { x: number; y: number };
type Menu =
  | { kind: "new"; at: Point }
  | { kind: "row"; name: string; entryKind: Kind; at: Point };

type Props = { deviceId: string };

function suggestName(kind: Kind, names: string[]) {
  const base = kind === "dir" ? "Untitled folder" : "Untitled.txt";
  if (!names.includes(base)) return base;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let n = 2;
  while (names.includes(`${stem} ${n}${ext}`)) n += 1;
  return `${stem} ${n}${ext}`;
}

export function FilesPane({ deviceId }: Props) {
  const files = useMachineFiles(deviceId);
  const trail = useRef<HTMLElement>(null);
  const filePick = useRef<HTMLInputElement>(null);
  const folderPick = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [draft, setDraft] = useState<Kind | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ name: string; kind: Kind } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const path = crumbs(files.listing?.root, files.dir, {
    rootLabel: files.listing?.root_label,
    isHome: files.listing?.is_home,
  });
  const entries = files.entries;
  const hiddenCount = (files.listing?.entries.length ?? 0) - entries.length;
  const names = entries.map((entry) => entry.name);
  const dropLabel = files.folderLabel;

  useEffect(() => {
    const node = trail.current;
    if (node) node.scrollLeft = node.scrollWidth;
  }, [files.dir, files.listing?.root]);

  useEffect(() => {
    folderPick.current?.setAttribute("webkitdirectory", "");
    folderPick.current?.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    const paused = Boolean(draft || renaming || confirm);
    files.hold(paused);
    return () => files.hold(false);
  }, [confirm, draft, files.hold, renaming]);

  function beginCreate(kind: Kind) {
    setMenu(null);
    setRenaming(null);
    setConfirm(null);
    setDraft(kind);
  }

  function beginRename(name: string) {
    setMenu(null);
    setDraft(null);
    setConfirm(null);
    setSelected(name);
    setRenaming(name);
  }

  async function commitDraft(name: string) {
    const clean = name.trim();
    if (!draft) return false;
    if (!clean) {
      setDraft(null);
      return true;
    }
    const ok = draft === "dir" ? await files.createFolder(clean) : await files.createFile(clean);
    if (ok) {
      setSelected(clean);
      setDraft(null);
    }
    return ok;
  }

  async function commitRename(name: string) {
    if (!renaming) return false;
    const clean = name.trim();
    if (!clean || clean === renaming) {
      setRenaming(null);
      return true;
    }
    const ok = await files.renameEntry(renaming, clean);
    if (ok) {
      setSelected(clean);
      setRenaming(null);
    }
    return ok;
  }

  async function commitDelete() {
    if (!confirm) return;
    const ok = await files.deleteEntry(confirm.name);
    if (!ok) return;
    if (selected === confirm.name) setSelected(null);
    setConfirm(null);
  }

  function openNewMenu(event: ReactMouse<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ kind: "new", at: { x: rect.left, y: rect.bottom + 4 } });
  }

  async function receiveUploads(list: Awaited<ReturnType<typeof itemsFromFileList>>) {
    setMenu(null);
    if (!list.length) return;
    setUploading(true);
    try {
      await files.uploadItems(list);
    } finally {
      setUploading(false);
    }
  }

  function onDragEnter(event: ReactDrag<HTMLDivElement>) {
    if (!hasFileDrag(event.dataTransfer) || files.busy) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragOver(event: ReactDrag<HTMLDivElement>) {
    if (!hasFileDrag(event.dataTransfer) || files.busy) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(event: ReactDrag<HTMLDivElement>) {
    if (!hasFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  async function onDrop(event: ReactDrag<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (files.busy) return;
    const items = await itemsFromDataTransfer(event.dataTransfer);
    await receiveUploads(items);
  }

  return (
    <div className={styles.browser}>
      <input
        ref={folderPick}
        type="file"
        multiple
        className={styles.srFile}
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const list = event.target.files;
          event.target.value = "";
          if (list?.length) void receiveUploads(itemsFromFileList(list));
        }}
      />
      <header className={styles.bar}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={files.goUp}
          disabled={!files.canGoUp || files.loading}
          aria-label="Parent folder"
          title="Parent folder"
        >
          <IconArrowUp size={14} />
        </button>
        <nav ref={trail} className={styles.crumbs} aria-label="Folder">
          {path.map((crumb, index) => {
            const current = index === path.length - 1;
            return (
              <span key={crumb.path || "root"} className={styles.crumbWrap}>
                {index > 0 ? <IconChevronRight size={12} /> : null}
                <button
                  type="button"
                  className={styles.crumb}
                  data-current={current}
                  title={crumb.title}
                  disabled={current}
                  onClick={() => files.openDir(crumb.path)}
                >
                  {crumb.label}
                </button>
              </span>
            );
          })}
        </nav>
        <span className={styles.count}>
          {files.listing
            ? `${entries.length} item${entries.length === 1 ? "" : "s"}${hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}`
            : ""}
        </span>
        <button
          type="button"
          className={styles.ghost}
          data-on={files.showDots}
          onClick={files.toggleDots}
          title={files.showDots ? "Hide dotfiles" : "Show dotfiles"}
        >
          .{files.showDots ? "on" : "off"}
        </button>
        <label
          className={`${styles.ghost} ${styles.uploadBtn}`}
          data-busy={uploading || files.busy ? "true" : undefined}
          title={`Upload into ${dropLabel} (max 1.5 MB)`}
        >
          <input
            ref={filePick}
            type="file"
            multiple
            className={styles.srFile}
            disabled={uploading || files.busy}
            onChange={(event) => {
              // Snapshot first — clearing value empties the live FileList in Chromium.
              const picked = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (picked.length) void receiveUploads(itemsFromFileList(picked));
            }}
          />
          <IconUpload size={14} /> {uploading ? "Uploading…" : "Upload"}
        </label>
        <button
          type="button"
          className={styles.ghost}
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "new"}
          onClick={openNewMenu}
        >
          <IconPlus size={14} /> New
        </button>
      </header>
      {uploading ? (
        <p className={styles.uploadStatus} aria-live="polite">
          Uploading into {dropLabel}…
        </p>
      ) : null}

      {confirm ? (
        <div className={styles.mkdir} role="alertdialog" aria-label={`Delete ${confirm.name}`}>
          <p className={styles.confirmText}>
            Delete {confirm.kind === "dir" ? "folder " : ""}“{confirm.name}”
            {confirm.kind === "dir" ? " and everything inside it" : ""}?
          </p>
          <button type="button" className={styles.danger} disabled={files.busy} onClick={() => void commitDelete()}>
            {files.busy ? "Deleting…" : "Delete"}
          </button>
          <button type="button" className={styles.ghost} onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </div>
      ) : null}

      {files.error ? (
        <p className={styles.alert} role="alert">
          {files.error}
          <button type="button" onClick={files.reload}>
            Try again
          </button>
        </p>
      ) : null}

      <div className={styles.stage} data-open={files.filePath ? "true" : "false"}>
        <div
          className={styles.listWrap}
          data-drop={dragging ? "true" : "false"}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={(event) => void onDrop(event)}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && files.canGoUp && !(event.target instanceof HTMLInputElement)) {
              event.preventDefault();
              files.goUp();
            }
          }}
          onContextMenu={(event) => {
            if ((event.target as HTMLElement).closest("[data-row]")) return;
            event.preventDefault();
            setMenu({ kind: "new", at: { x: event.clientX, y: event.clientY } });
          }}
        >
          {dragging ? (
            <div className={styles.dropHint} aria-live="polite">
              <IconUpload size={20} />
              <p>
                Drop into <strong>{dropLabel}</strong>
              </p>
            </div>
          ) : null}
          {files.loading && !files.listing ? (
            <div className={styles.skeleton} aria-label="Loading files">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          ) : null}
          {files.listing && entries.length === 0 && !draft && !files.loading ? (
            <div className={styles.empty}>
              <IconFolder size={22} />
              <p>
                <strong>{files.folderLabel}</strong> is empty.
              </p>
              <p className={styles.emptyHint}>
                Drag files here, use Upload, or New for an empty file or folder.
              </p>
            </div>
          ) : null}
          <ul className={styles.list} aria-label="Files" data-busy={files.loading}>
            {files.canGoUp ? (
              <li>
                <button type="button" className={styles.entry} data-kind="dir" onClick={files.goUp}>
                  <IconFolder size={15} />
                  <span className={styles.name}>..</span>
                  <span className={styles.meta}>parent</span>
                </button>
              </li>
            ) : null}
            {draft ? (
              <li className={styles.row} data-row>
                <NameField
                  initial={suggestName(draft, names)}
                  icon={draft === "dir" ? <IconFolder size={15} /> : <IconFile size={15} />}
                  busy={files.busy}
                  onCommit={commitDraft}
                  onCancel={() => setDraft(null)}
                />
              </li>
            ) : null}
            {entries.map((entry) => {
              const isDir = entry.kind === "dir";
              const kind: Kind = isDir ? "dir" : "file";
              const entryPath = files.dir ? `${files.dir}/${entry.name}` : entry.name;
              return (
                <li
                  key={entry.name}
                  className={styles.row}
                  data-row
                  data-open={menu?.kind === "row" && menu.name === entry.name}
                  onContextMenu={(event) => {
                    if (renaming === entry.name) return;
                    event.preventDefault();
                    setSelected(entry.name);
                    setMenu({
                      kind: "row",
                      name: entry.name,
                      entryKind: kind,
                      at: { x: event.clientX, y: event.clientY },
                    });
                  }}
                >
                  {renaming === entry.name ? (
                    <NameField
                      initial={entry.name}
                      icon={isDir ? <IconFolder size={15} /> : <IconFile size={15} />}
                      busy={files.busy}
                      onCommit={commitRename}
                      onCancel={() => setRenaming(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className={styles.entry}
                      data-kind={entry.kind}
                      data-hidden={entry.name.startsWith(".")}
                      data-selected={selected === entry.name}
                      data-active={entryPath === files.filePath}
                      aria-current={entryPath === files.filePath ? "true" : undefined}
                      onClick={() => {
                        setSelected(entry.name);
                        files.openEntry(entry.name, entry.kind);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          files.openEntry(entry.name, entry.kind);
                        }
                        if (event.key === "F2") {
                          event.preventDefault();
                          beginRename(entry.name);
                        }
                        if (event.key === "Delete") {
                          event.preventDefault();
                          setConfirm({ name: entry.name, kind });
                        }
                      }}
                    >
                      {isDir ? <IconFolder size={15} /> : <IconFile size={15} />}
                      <span className={styles.name}>{entry.name}</span>
                      <span className={styles.meta}>{isDir ? "" : formatSize(entry.size)}</span>
                      {isDir ? <IconChevronRight size={14} className={styles.chevron} /> : null}
                    </button>
                  )}
                  {renaming === entry.name ? null : (
                    <button
                      type="button"
                      className={styles.more}
                      aria-label={`Actions for ${entry.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        setSelected(entry.name);
                        setMenu({
                          kind: "row",
                          name: entry.name,
                          entryKind: kind,
                          at: { x: rect.right - 168, y: rect.bottom + 4 },
                        });
                      }}
                    >
                      <IconDots size={14} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <FileEditor files={files} />
      </div>

      {menu ? (
        <PopMenu at={menu.at} onClose={() => setMenu(null)}>
          {menu.kind === "new" ? (
            <>
              <button type="button" role="menuitem" onClick={() => beginCreate("dir")}>
                <IconFolder size={14} /> Folder
              </button>
              <button type="button" role="menuitem" onClick={() => beginCreate("file")}>
                <IconFile size={14} /> File
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  // Defer so the menu unmounts before the picker opens (gesture-safe).
                  window.setTimeout(() => filePick.current?.click(), 0);
                }}
              >
                <IconUpload size={14} /> Upload files
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  folderPick.current?.click();
                }}
              >
                <IconFolder size={14} /> Upload folder
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const current = menu;
                  setMenu(null);
                  if (current.kind === "row") files.openEntry(current.name, current.entryKind);
                }}
              >
                {menu.entryKind === "dir" ? <IconFolder size={14} /> : <IconPencil size={14} />}
                {menu.entryKind === "dir" ? "Open" : "Edit"}
              </button>
              <button type="button" role="menuitem" onClick={() => beginRename(menu.name)}>
                <IconPencil size={14} /> Rename
              </button>
              <button
                type="button"
                role="menuitem"
                data-danger
                onClick={() => {
                  setMenu(null);
                  setConfirm({ name: menu.name, kind: menu.entryKind });
                }}
              >
                <IconTrash size={14} /> Delete
              </button>
            </>
          )}
        </PopMenu>
      ) : null}
    </div>
  );
}

function NameField({
  initial,
  icon,
  busy,
  onCommit,
  onCancel,
}: {
  initial: string;
  icon: ReactNode;
  busy: boolean;
  onCommit: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  async function finish(commit: boolean) {
    if (done.current || busy) return;
    if (!commit) {
      done.current = true;
      onCancel();
      return;
    }
    done.current = true;
    const ok = await onCommit(value);
    if (!ok) done.current = false;
  }

  return (
    <form
      className={styles.nameForm}
      onSubmit={(event) => {
        event.preventDefault();
        void finish(true);
      }}
    >
      {icon}
      <input
        ref={input}
        value={value}
        aria-label="Name"
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void finish(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            void finish(false);
          }
        }}
      />
    </form>
  );
}

function PopMenu({ at, onClose, children }: { at: Point; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const left = Math.max(8, Math.min(at.x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(at.y, window.innerHeight - rect.height - 8));
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }, [at.x, at.y]);

  useEffect(() => {
    const down = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className={styles.pop} style={{ left: at.x, top: at.y }} role="menu">
      {children}
    </div>,
    document.body
  );
}
