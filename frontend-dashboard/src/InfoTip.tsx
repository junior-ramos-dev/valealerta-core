import { useState } from "react";
import { createPortal } from "react-dom";

export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  return (
    <>
      <span
        role="img"
        aria-label={text}
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const width = 260;
          const left = Math.min(r.right + 8, window.innerWidth - width - 12);
          const top = Math.min(r.top, window.innerHeight - 160);
          setPos({ top, left: Math.max(8, left) });
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 15,
          height: 15,
          marginLeft: 6,
          borderRadius: "50%",
          border: "1px solid #6eb8d4",
          color: "#7FDBFA",
          fontSize: 10,
          fontWeight: 700,
          lineHeight: 1,
          cursor: "help",
          flexShrink: 0,
          verticalAlign: "middle",
        }}
      >
        i
      </span>
      {open &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: 260,
              zIndex: 10000,
              background: "#1a1a1a",
              color: "#ddd",
              border: "1px solid #3a3a3a",
              borderRadius: 6,
              padding: "10px 12px",
              fontSize: 11,
              lineHeight: 1.45,
              boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
              pointerEvents: "none",
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
