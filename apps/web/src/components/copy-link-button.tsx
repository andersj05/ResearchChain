import { useState } from "react";
import styles from "./copy-link-button.module.css";

export function CopyLinkButton({
  getUrl,
  button,
  success,
  fallback,
}: {
  getUrl: () => URL;
  button: string;
  success: string;
  fallback?: string;
}) {
  const [feedback, setFeedback] = useState<{ message: string; manualLink?: string }>();
  async function copy() {
    const href = getUrl().href;
    try {
      await navigator.clipboard.writeText(href);
      setFeedback({ message: success });
    } catch {
      setFeedback(
        fallback
          ? { message: fallback }
          : { message: "Could not copy the link. Copy it below.", manualLink: href },
      );
    }
  }
  return (
    <>
      <button className="button small" type="button" onClick={copy}>
        {button}
      </button>
      {feedback && (
        <span className="field-hint" role="status">
          {feedback.message}
        </span>
      )}
      {feedback?.manualLink && (
        <input
          className={styles.manual}
          aria-label={`${button} manually`}
          type="url"
          value={feedback.manualLink}
          onFocus={(event) => event.currentTarget.select()}
          readOnly
        />
      )}
    </>
  );
}
