"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { MAX_CHAT_INPUT_CHARS, type ModelChoice } from "@nebius-desk/shared/index";
import { IconArrowUp, IconMic, IconPlus } from "@/ui/icons";
import { ModelPicker } from "@/features/chat/ModelPicker";
import { useDictation } from "@/features/chat/useDictation";
import { useDeskGuideOptional } from "@/features/millie/DeskGuideContext";
import styles from "./Composer.module.css";

const FAST_WINDOW_MS = 420;
const FAST_KEYS = 9;
const LONG_PASTE_CHARS = 240;
/** Show the counter once a draft gets close to the cap. */
const COUNTER_FROM = Math.floor(MAX_CHAT_INPUT_CHARS * 0.8);

type Command = { name: string; hint: string };

const COMMANDS: Command[] = [
  { name: "/new", hint: "Start a new chat on this device" },
  { name: "/memory", hint: "Save a fact as a shared memory file" },
  { name: "/expert", hint: "Call an expert: /expert Name your question" },
];

type Props = {
  sending: boolean;
  modelLabel: string;
  modelId?: string;
  choice: ModelChoice;
  onChoice: (next: ModelChoice) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onNewChat: () => void;
  onSaveMemory: (text: string) => Promise<void>;
  seed?: { text: string; nonce: number } | null;
  deviceName?: string;
  cloudOnly?: boolean;
};

export function Composer({
  sending,
  modelLabel,
  modelId,
  choice,
  onChoice,
  onSend,
  onStop,
  onNewChat,
  onSaveMemory,
  seed,
  deviceName,
  cloudOnly = false,
}: Props) {
  const [value, setValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);
  const deskGuide = useDeskGuideOptional();
  const keyTimes = useRef<number[]>([]);
  const dictation = useDictation((text) => setValue((v) => (v ? `${v} ${text}` : text)));

  function noteTyped(added: number) {
    if (added <= 0 || added > 4) return; // ignore bulk replaces; paste handled separately
    const now = performance.now();
    const times = keyTimes.current;
    times.push(now);
    while (times.length && now - times[0] > FAST_WINDOW_MS) times.shift();
    if (times.length >= FAST_KEYS) {
      times.length = 0;
      deskGuide?.notifyComposerCue({ kind: "fast_type" });
    }
  }

  const matches = useMemo(() => {
    if (!value.startsWith("/") || value.includes(" ")) return [];
    return COMMANDS.filter((c) => c.name.startsWith(value.toLowerCase()));
  }, [value]);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  useEffect(() => {
    ta.current?.focus();
  }, []);

  useEffect(() => {
    if (!seed) return;
    setValue(seed.text);
    const el = ta.current;
    if (el) {
      el.focus();
      window.requestAnimationFrame(() => el.setSelectionRange(seed.text.length, seed.text.length));
    }
  }, [seed]);

  useEffect(() => setActive(0), [matches.length]);

  const length = value.trim().length;
  const tooLong = length > MAX_CHAT_INPUT_CHARS;

  function flash(text: string) {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 1800);
  }

  async function submit(raw = value) {
    const text = raw.trim();
    if (!text || sending) return;
    if (text.length > MAX_CHAT_INPUT_CHARS) {
      return flash(`Too long — ${MAX_CHAT_INPUT_CHARS.toLocaleString()} characters max. Upload big text as a file.`);
    }
    if (text === "/new") {
      setValue("");
      onNewChat();
      return;
    }
    if (text.startsWith("/memory")) {
      const note = text.slice("/memory".length).trim();
      if (!note) return flash("Add a fact after /memory");
      setValue("");
      await onSaveMemory(note);
      return flash("Saved as a memory file");
    }
    if (text.startsWith("/expert")) {
      const rest = text.slice("/expert".length).trim();
      const split = rest.indexOf(" ");
      if (split <= 0) return flash("Write /expert Name and the question");
      const expert = rest.slice(0, split).replace(/^@/, "");
      const question = rest.slice(split + 1).trim();
      if (!question) return flash("Write /expert Name and the question");
      setValue("");
      onSend(`@${expert} ${question}`);
      return;
    }
    setValue("");
    onSend(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        setActive((i) => (i + dir + matches.length) % matches.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        setValue(`${matches[active].name} `);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className={styles.wrap}>
      {matches.length ? (
        <ul className={styles.commands} role="listbox" aria-label="Commands">
          {matches.map((c, i) => (
            <li key={c.name} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setValue(`${c.name} `)}>
                <strong>{c.name}</strong>
                <span>{c.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className={styles.box}
        data-guide="chat.composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={ta}
          value={value}
          rows={1}
          placeholder="Message the agent — / for commands"
          aria-label="Message"
          onChange={(e) => {
            const next = e.target.value;
            const delta = next.length - value.length;
            setValue(next);
            noteTyped(delta);
          }}
          onPaste={(e) => {
            const text = e.clipboardData?.getData("text") || "";
            if (text.length >= LONG_PASTE_CHARS) {
              deskGuide?.notifyComposerCue({ kind: "long_paste", chars: text.length });
            }
          }}
          onKeyDown={onKeyDown}
        />
        <div className={styles.tools}>
        <div className={styles.plusWrap}>
          <button
            type="button"
            className={styles.icon}
            aria-label="More actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <IconPlus size={16} />
          </button>
          {menuOpen ? (
            <div className={styles.menu} role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onNewChat();
                }}
              >
                New chat
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!value.trim()}
                onClick={() => {
                  setMenuOpen(false);
                  void submit(`/memory ${value}`);
                }}
              >
                Save draft as a memory file
              </button>
            </div>
          ) : null}
        </div>

        <ModelPicker value={choice} onChange={onChoice} deviceName={deviceName} cloudOnly={cloudOnly} />
        <span className={styles.spacer} />
        {length >= COUNTER_FROM ? (
          <span className={styles.counter} data-over={tooLong} aria-live="polite">
            {length.toLocaleString()} / {MAX_CHAT_INPUT_CHARS.toLocaleString()}
          </span>
        ) : null}
        <span className={styles.model} title={modelId || undefined}>
          <i className={styles.status} data-busy={sending} aria-hidden />
          {modelLabel}
        </span>

        {dictation.supported ? (
          <button
            type="button"
            className={styles.icon}
            data-live={dictation.listening}
            aria-label={dictation.listening ? "Stop dictation" : "Dictate"}
            onClick={dictation.toggle}
          >
            <IconMic size={16} />
          </button>
        ) : null}
        {sending ? (
          <button type="button" className={styles.send} onClick={onStop} aria-label="Stop generating">
            <span className={styles.stopIcon} aria-hidden />
          </button>
        ) : (
          <button
            type="submit"
            className={styles.send}
            disabled={!value.trim() || tooLong}
            aria-label={tooLong ? "Message is too long to send" : "Send"}
          >
            <IconArrowUp size={15} />
          </button>
        )}
        </div>
      </form>

      <p className={styles.hint} aria-live="polite">
        {notice ??
          (tooLong
            ? `Too long — trim to ${MAX_CHAT_INPUT_CHARS.toLocaleString()} characters or upload it as a file`
            : "Enter to send · /memory saves a fact · /expert Name calls a profile")}
      </p>
    </div>
  );
}
