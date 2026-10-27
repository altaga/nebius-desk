"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { IconChevronRight, IconFile, IconFolder, IconRetry, IconX } from "@/ui/icons";
import { crumbs, formatSize, useMachineFiles } from "./useMachineFiles";
import styles from "./FilesPane.module.css";

export function FilesPane() {
  const files = useMachineFiles();
  const trail = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const entries = files.listing?.entries ?? [];
  const path = crumbs(files.listing?.root, files.dir);

  useEffect(() => {
    const node = trail.current;
    if (node) node.scrollLeft = node.scrollWidth;
  }, [files.dir, files.listing?.root]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[data-active='true']")?.scrollIntoView({ block: "nearest" });
  }, [files.filePath]);

  return (
    <div className={styles.browser}>
      <header className={styles.bar}>
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
        <span className={styles.count}>{files.listing ? `${entries.length} items` : ""}</span>
        <button type="button" className={styles.iconBtn} onClick={files.reload} aria-label="Refresh folder">
          <IconRetry size={14} />
        </button>
      </header>

      <div className={styles.stage} data-open={files.filePath ? "true" : "false"}>
        <div className={styles.listWrap}>
          {files.error ? (
            <p className={styles.alert} role="alert">
              {files.error}
              <button type="button" onClick={files.reload}>
                Try again
              </button>
            </p>
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
          {files.listing && entries.length === 0 ? <p className={styles.empty}>This folder is empty.</p> : null}
          <ul ref={list} className={styles.list} aria-label="Files" data-busy={files.loading}>
            {entries.map((entry) => {
              const entryPath = files.dir ? `${files.dir}/${entry.name}` : entry.name;
              const active = entryPath === files.filePath;
              return (
                <li key={entry.name}>
                  <button
                    type="button"
                    className={styles.entry}
                    data-kind={entry.kind}
                    data-hidden={entry.name.startsWith(".")}
                    data-active={active}
                    aria-current={active ? "true" : undefined}
                    onClick={() => files.openEntry(entry.name, entry.kind)}
                  >
                    {entry.kind === "dir" ? <IconFolder size={15} /> : <IconFile size={15} />}
                    <span className={styles.name}>{entry.name}</span>
                    <span className={styles.meta}>{entry.kind === "dir" ? "" : formatSize(entry.size)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <FileEditor files={files} />
      </div>
    </div>
  );
}

function FileEditor({ files }: { files: ReturnType<typeof useMachineFiles> }) {
  const name = files.filePath?.split("/").pop() ?? "";

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void files.save();
    }
  }

  if (!files.filePath && !files.opening) {
    return (
      <div className={styles.editor}>
        <div className={styles.placeholder}>
          <IconFile size={18} />
          <p>Open a file to read or edit it on this machine.</p>
        </div>
      </div>
    );
  }

  return (
    <form
      className={styles.editor}
      onSubmit={(event) => {
        event.preventDefault();
        void files.save();
      }}
    >
      <div className={styles.editorBar}>
        <strong title={files.filePath ?? undefined}>
          {files.dirty ? <i className={styles.dot} aria-hidden /> : null}
          {files.opening ? "Opening…" : name}
        </strong>
        <span className={styles.status} data-dirty={files.dirty}>
          {files.fileError ? files.fileError : files.pending ? "Unsaved changes" : files.dirty ? "Unsaved" : files.saved ? "Saved" : ""}
        </span>
        {files.pending ? (
          <>
            <button type="button" className={styles.ghost} onClick={files.keepEditing}>
              Keep
            </button>
            <button type="button" className={styles.ghost} onClick={files.discard}>
              Discard
            </button>
          </>
        ) : (
          <>
            <button type="button" className={styles.iconBtn} onClick={files.closeFile} aria-label="Close file">
              <IconX size={14} />
            </button>
            <button type="submit" className={styles.save} disabled={!files.dirty || files.saving || files.opening}>
              {files.saving ? "Saving" : "Save"}
            </button>
          </>
        )}
      </div>
      <textarea
        className={styles.area}
        value={files.draft}
        aria-label={name ? `Contents of ${name}` : "File contents"}
        spellCheck={false}
        disabled={files.opening || Boolean(files.pending)}
        onChange={(event) => files.edit(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </form>
  );
}
