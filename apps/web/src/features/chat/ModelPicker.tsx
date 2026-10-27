"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ModelChoice } from "@nebius-desk/shared/index";
import { IconRoute } from "@/ui/icons";
import styles from "./ModelPicker.module.css";

type Option = { id: ModelChoice; label: string; tag: string; hint: string };

const CLOUD_ONLY: ModelChoice[] = ["nano", "fast", "heavy"];

function optionsFor(deviceName: string, cloudOnly: boolean): Option[] {
  const board = deviceName.trim() || "this board";
  const all: Option[] = [
    { id: "auto", label: "Auto", tag: "routes", hint: "Short, everyday, or hard." },
    { id: "local", label: "Local", tag: "free", hint: `Qwen on ${board}.` },
    { id: "nano", label: "Nano", tag: "short", hint: "Brief answers on Nebius." },
    { id: "fast", label: "Lightning", tag: "fast", hint: "Everyday questions and code." },
    { id: "heavy", label: "Super", tag: "deep", hint: "Hard problems. Thinks first." },
  ];
  return cloudOnly ? all.filter((o) => CLOUD_ONLY.includes(o.id)) : all;
}

type Props = {
  value: ModelChoice;
  onChange: (next: ModelChoice) => void;
  deviceName?: string;
  /** Docker board-emu (and similar): Nano / Lightning / Super only. */
  cloudOnly?: boolean;
};

export function ModelPicker({
  value,
  onChange,
  deviceName = "this board",
  cloudOnly = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const options = useMemo(() => optionsFor(deviceName, cloudOnly), [deviceName, cloudOnly]);
  const current = options.find((o) => o.id === value) ?? options[0];

  useEffect(() => {
    if (!options.some((o) => o.id === value) && options[0]) onChange(options[0].id);
  }, [options, value, onChange]);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, value, options]);

  function choose(id: ModelChoice) {
    onChange(id);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") return setOpen(false);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + dir + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(options[active].id);
    }
  }

  return (
    <div className={styles.root} ref={root} onKeyDown={onKeyDown}>
      <button
        type="button"
        className={styles.trigger}
        data-auto={value === "auto"}
        data-guide="chat.model_picker"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={current.hint}
        onClick={() => setOpen((v) => !v)}
      >
        <IconRoute size={13} />
        {current.label}
      </button>
      {open ? (
        <ul className={styles.list} role="listbox" aria-label="Model">
          {options.map((o, i) => (
            <li key={o.id} role="option" aria-selected={o.id === value} data-active={i === active}>
              <button type="button" onClick={() => choose(o.id)} onMouseEnter={() => setActive(i)}>
                <span className={styles.row}>
                  <strong>{o.label}</strong>
                  <em>{o.tag}</em>
                </span>
                <span className={styles.hint}>{o.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
