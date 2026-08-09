import { splitCitations } from "@/lib/incident";

// Renders prose with [E7]-style citations turned into clickable chips. This is what
// makes auditability a UI affordance rather than a promise: every citation the model
// made is one click from the literal query and response behind it.
export function CitedText({ text, onCite, className = "" }) {
  if (!text) return null;
  const parts = splitCitations(text);

  return (
    <p className={`whitespace-pre-wrap t-body leading-relaxed text-foreground ${className}`}>
      {parts.map((part, i) =>
        part.citation ? (
          <button
            key={i}
            onClick={() => onCite(part.citation)}
            className="mx-0.5 rounded bg-signal-dim px-1 font-mono t-label font-medium text-signal hover:bg-signal/25"
          >
            {part.citation}
          </button>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}
