import { DIDNT_GET_IT } from "./copy";

/**
 * "Didn't get it?" (#119): the same three lines for every address on the code, forgot-password and finish-setup screens,
 * so it never says whether anything was sent. A closed native disclosure (no script) right under the resend control.
 * `host` is the stable Preview address on the Preview and null everywhere else (the server decides; see request-origin.ts).
 */
export function DidntGetIt({ host }: { host?: string | null }) {
  return (
    <details className="didnt-get-it">
      <summary>{DIDNT_GET_IT.summary}</summary>
      <ul>
        {DIDNT_GET_IT.lines(host ?? null).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
  );
}
