"use client";

import { useRef, useState } from "react";

type Props = {
  initial: string;
  label: string;
  className?: string;
  onSave: (title: string) => Promise<void>;
  onCancel: () => void;
};

export function TitleRename({ initial, label, className, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const closed = useRef(false);
  const busy = useRef(false);

  function cancel() {
    closed.current = true;
    onCancel();
  }

  async function save() {
    if (closed.current || busy.current) return;
    const clean = draft.trim();
    if (!clean || clean === initial.trim()) {
      cancel();
      return;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(clean);
      closed.current = true;
      onCancel();
    } catch (err) {
      busy.current = false;
      setSaving(false);
      setError(err instanceof Error ? err.message : "Could not save this name");
    }
  }

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <input
        autoFocus
        value={draft}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.form?.contains(next)) return;
          void save();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          cancel();
        }}
      />
      <button type="submit" disabled={saving || !draft.trim()}>
        {saving ? "Saving" : "Save"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
