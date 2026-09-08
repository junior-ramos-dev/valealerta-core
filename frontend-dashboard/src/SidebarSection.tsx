import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type HelpCtx = {
  railEl: HTMLDivElement | null;
  helpOpen: boolean;
  hoverId: string | null;
  setHoverId: (id: string | null) => void;
};

const HelpContext = createContext<HelpCtx | null>(null);

export function SidebarDock({
  helpOpen,
  children,
}: {
  helpOpen: boolean;
  children: ReactNode;
}) {
  const [railEl, setRailEl] = useState<HTMLDivElement | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  return (
    <HelpContext.Provider value={{ railEl, helpOpen, hoverId, setHoverId }}>
      <aside
        id="sidebar-help-rail"
        className={`sidebar-dock${helpOpen ? " is-help-open" : ""}`}
      >
        <div className="sheet-handle">
          <span className="sheet-handle-bar" aria-hidden />
          <span className="sheet-handle-label">
            {helpOpen
              ? "Deslize os cards de ajuda"
              : "Role para ver todos os controles"}
          </span>
        </div>
        <div className="sidebar-help-rail" aria-hidden={!helpOpen}>
          <div className="sidebar-help-rail-inner" ref={setRailEl} />
        </div>
        <div id="sidebar-main" className="sidebar-main">
          {children}
        </div>
      </aside>
    </HelpContext.Provider>
  );
}

function HelpCard({
  id,
  title,
  help,
}: {
  id: string;
  title: string;
  help: ReactNode;
}) {
  const ctx = useContext(HelpContext);
  const hot = ctx?.hoverId === id;
  return (
    <article
      className={`sidebar-help-card${hot ? " is-hot" : ""}`}
      onMouseEnter={() => ctx?.setHoverId(id)}
      onMouseLeave={() => ctx?.setHoverId(null)}
    >
      <h3 className="sidebar-help-title">{title}</h3>
      {typeof help === "string" ? <p>{help}</p> : help}
    </article>
  );
}

export function SidebarSection({
  id,
  title,
  help,
  slot = "more",
  children,
}: {
  id: string;
  title?: string;
  help?: ReactNode;
  /** On the phone sheet, peek blocks sit first; more follows in the same scroll. */
  slot?: "peek" | "more";
  children: ReactNode;
}) {
  const ctx = useContext(HelpContext);
  const hot = Boolean(ctx?.helpOpen && ctx.hoverId === id);
  return (
    <>
      <div
        className={`sidebar-block sidebar-slot-${slot}${hot ? " is-hot" : ""}`}
        data-id={id}
        onMouseEnter={() => ctx?.setHoverId(id)}
        onMouseLeave={() => ctx?.setHoverId(null)}
      >
        {children}
      </div>
      {ctx?.helpOpen && ctx.railEl && help && title
        ? createPortal(
            <HelpCard id={id} title={title} help={help} />,
            ctx.railEl,
          )
        : null}
    </>
  );
}
