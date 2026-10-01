import "../../styles/workspace.css";

export interface ErrorStateProps {
  code: string;
  message: string;
  action?: { label: string; onClick: () => void };
}

/**
 * Error banner — spec 18.7. Shows the server-provided code and message
 * verbatim (e.g. "Server unreachable", "LLM missing") plus an optional
 * next action (retry, open partial report, etc).
 */
export function ErrorState({ code, message, action }: ErrorStateProps): JSX.Element {
  return (
    <div className="ws-error-state" role="alert">
      <span className="ws-error-state__code">{code}</span>
      <span className="ws-error-state__message">{message}</span>
      {action ? (
        <button type="button" className="ws-error-state__action" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
