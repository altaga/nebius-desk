"use client";

import type { KeyboardEvent } from "react";
import { IconFile, IconX } from "@/ui/icons";
import { useMachineFiles } from "./useMachineFiles";
import styles from "./FilesPane.module.css";

type Files = ReturnType<typeof useMachineFiles>;

export function FileEditor({ files }: { files: Files }) {
  const name = files.filePath?.split("/").pop() ?? "";
  const isVideo = files.previewKind === "video" && Boolean(files.previewUrl);
  const isImage = (files.previewKind === "image" && Boolean(files.previewUrl)) || isVideo;

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
          <p>Open a file to edit it here. Use New for a folder or an empty file.</p>
          {files.fileError ? <p className={styles.alert}>{files.fileError}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <form
      className={styles.editor}
      onSubmit={(event) => {
        event.preventDefault();
        if (!isImage) void files.save();
      }}
    >
      <div className={styles.editorBar}>
        <strong title={files.filePath ?? undefined}>
          {files.dirty ? <i className={styles.dot} aria-hidden /> : null}
          {files.opening ? "Opening…" : name}
        </strong>
        <span className={styles.status} data-dirty={files.dirty}>
          {files.fileError
            ? files.fileError
            : files.pending
              ? "Unsaved changes"
              : isImage
                ? "Preview"
                : files.dirty
                  ? "Unsaved"
                  : files.saved
                    ? "Saved"
                    : ""}
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
            {isImage ? null : (
              <button type="submit" className={styles.save} disabled={!files.dirty || files.saving || files.opening}>
                {files.saving ? "Saving" : "Save"}
              </button>
            )}
          </>
        )}
      </div>
      {files.fileError && !isImage ? (
        <div className={styles.previewEmpty} role="alert">
          <p>{files.fileError}</p>
        </div>
      ) : isVideo ? (
        <div className={styles.preview}>
          <video
            key={files.previewUrl!}
            src={files.previewUrl!}
            className={styles.previewImg}
            controls
            playsInline
            preload="metadata"
            aria-label={name}
            onError={() => files.mediaFailed("This video could not be played. Try downloading it from the board.")}
          />
        </div>
      ) : isImage ? (
        <div className={styles.preview}>
          <img src={files.previewUrl!} alt={name} className={styles.previewImg} />
        </div>
      ) : (
        <textarea
          className={styles.area}
          value={files.draft}
          aria-label={name ? `Contents of ${name}` : "File contents"}
          spellCheck={false}
          disabled={files.opening || Boolean(files.pending)}
          onChange={(event) => files.edit(event.target.value)}
          onKeyDown={onKeyDown}
        />
      )}
    </form>
  );
}
