import type { ReactNode } from "react";
import styles from "./processing-label.module.css";

/** Motion belongs only to observed active processing, never terminal history. */
export function ProcessingLabel({ children, animated }: { children: ReactNode; animated: boolean }) {
  return <span className={styles.label} data-processing-animated={animated ? "true" : undefined}>{children}</span>;
}
