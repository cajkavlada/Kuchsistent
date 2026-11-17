import { useEffect, useRef, useState } from "react";
import { Sheet } from "~/components/recipes/ui";
import { copyText, handoffLines, type HandoffItem, rohlikPrompt } from "~/lib/rohlik";

/**
 * The Rohlík hand-off card (#31) above a Rohlík trip's list: copy the list as
 * plain lines, or open the AI-fill sheet with a prompt for ChatGPT with the
 * Rohlík app. Ticking an item on a Rohlík trip means it's in the cart.
 */
export function RohlikCard({
  date,
  items,
  locked = false,
}: {
  date: string;
  items: HandoffItem[];
  /** Offline (#13): the actions are off, "Bez připojení". */
  locked?: boolean;
}) {
  const [copied, flash] = useCopied();
  const [ai, setAi] = useState(false);
  const lines = handoffLines(items);
  const empty = lines.length === 0;

  async function copyList() {
    if (await copyText(lines.join("\n"))) flash();
  }

  return (
    <div className="handoff">
      <p className="handoff-title">
        <b>🚚 Rohlík doručení</b> <small className="muted">– objednávku dokončíš na rohlik.cz</small>
      </p>
      <div className="handoff-btns">
        <button className="btn rl" disabled={empty || locked} onClick={() => void copyList()}>
          {copied ? "✓ Zkopírováno" : "📋 Kopírovat seznam"}
        </button>
        <button className="btn rl" disabled={empty || locked} onClick={() => setAi(true)}>
          ✨ Naplnit košík s AI
        </button>
      </div>
      <p className="muted small">
        {locked
          ? "Bez připojení – Rohlík půjde použít, až bude signál."
          : empty
          ? "Všechno je v košíku."
          : `${lines.length} ${itemsWord(lines.length)} do košíku. U položek je 🔎 odkaz na hledání. Odškrtni, co máš v košíku.`}
      </p>
      {ai && !locked && <AiFillSheet prompt={rohlikPrompt(date, items)} onClose={() => setAi(false)} />}
    </div>
  );
}

/** "✨ Naplnit košík s AI": three steps, the read-only prompt, one copy button. */
function AiFillSheet({ prompt, onClose }: { prompt: string; onClose: () => void }) {
  const [copied, flash] = useCopied();
  async function copy() {
    if (await copyText(prompt)) flash();
  }
  return (
    <Sheet title="✨ Naplnit košík s AI" onClose={onClose}>
      <ol className="ai-steps">
        <li>Zkopíruj prompt.</li>
        <li>
          Vlož ho do ChatGPT, kde máš připojenou aplikaci Rohlík (začíná <b>/rohlik</b>, takže ChatGPT
          použije Rohlík), a nech ho naplnit košík.
        </li>
        <li>ChatGPT ti na konci pošle odkaz na přehled košíku na Rohlíku – tam ho projdeš a objednáš.</li>
      </ol>
      <textarea className="finput ai-prompt" readOnly value={prompt} rows={10} aria-label="Prompt" />
      <button className="btn rl" onClick={() => void copy()}>
        {copied ? "✓ Prompt zkopírován" : "📋 Kopírovat prompt"}
      </button>
    </Sheet>
  );
}

/** A "copied" flag that clears itself after a moment. */
function useCopied(): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [
    copied,
    () => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    },
  ];
}

function itemsWord(n: number): string {
  if (n === 1) return "položka";
  return n >= 2 && n <= 4 ? "položky" : "položek";
}
