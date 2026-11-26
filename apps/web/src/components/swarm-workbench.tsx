import { useState, type ReactNode } from "react";
import { Columns3, Rows3 } from "lucide-react";
import { ownerStoragePrefix } from "@/lib/access";
import { useOwner } from "./access-context";
import styles from "./research-session.module.css";

export function SwarmWorkbench({
  inspector,
  children,
}: {
  inspector: ReactNode;
  children: ReactNode;
}) {
  const { owner } = useOwner();
  const preference = ownerStoragePrefix(owner) + ".study.layout";
  const [stacked, setStacked] = useState(() => {
    try {
      return localStorage.getItem(preference) === "page";
    } catch {
      return false;
    }
  });
  function changeLayout(page: boolean) {
    setStacked(page);
    try {
      localStorage.setItem(preference, page ? "page" : "split");
    } catch {
      // The current study can still switch layouts without browser storage.
    }
  }
  return (
    <section
      className={styles.workbench}
      data-stacked={stacked || undefined}
      aria-label="Study workspace"
    >
      <header className={styles.workbenchBar}>
        <h2>Study workspace</h2>
        <div role="group" aria-label="Workspace layout">
          <button type="button" aria-pressed={!stacked} onClick={() => changeLayout(false)}>
            <Columns3 size={14} aria-hidden /> Split view
          </button>
          <button type="button" aria-pressed={stacked} onClick={() => changeLayout(true)}>
            <Rows3 size={14} aria-hidden /> Page view
          </button>
        </div>
      </header>
      <div className={styles.workbenchBody}>
        {children}
        <aside className={styles.inspector} aria-label="Team and decisions">
          {inspector}
        </aside>
      </div>
    </section>
  );
}
