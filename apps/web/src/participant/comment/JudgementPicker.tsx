import { useId } from "react";

import { copy } from "../copy.ts";
import { type SubmissionJudgement } from "../types.ts";

const ORDER: SubmissionJudgement[] = ["sign", "sign_conditional", "comment", "decline"];

/**
 * `specs/behaviors/review-and-judgement.md` § Submission — the judgement
 * table, radio-driven, labels swapped by whether the person currently holds
 * a live signature; `sign_conditional` ("make my signature conditional")
 * disabled with a hint until there's at least one comment.
 */
export function JudgementPicker({
  value,
  onChange,
  isCurrentSigner,
  hasComments,
  disabled,
}: {
  value: SubmissionJudgement | null;
  onChange: (judgement: SubmissionJudgement) => void;
  isCurrentSigner: boolean;
  hasComments: boolean;
  disabled?: boolean;
}): JSX.Element {
  const formId = useId();
  const labels = isCurrentSigner
    ? copy.commentMode.judgement.currentlySigned
    : copy.commentMode.judgement.notSigned;

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-sm font-semibold text-foreground">
        {copy.commentMode.judgement.legend}
      </legend>
      {ORDER.map((judgement) => {
        const isConditional = judgement === "sign_conditional";
        const optionDisabled = isConditional && !hasComments;
        return (
          <label
            key={judgement}
            className={`flex flex-col gap-0.5 rounded border p-2 text-sm ${
              value === judgement ? "border-foreground" : "border-border"
            } ${optionDisabled ? "opacity-50" : ""}`}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name={`${formId}-judgement`}
                checked={value === judgement}
                disabled={optionDisabled}
                onChange={() => onChange(judgement)}
              />
              {labels[judgement]}
            </span>
            <span className="pl-6 text-xs text-muted-foreground">
              {optionDisabled
                ? copy.commentMode.judgement.conditionalDisabledHint
                : copy.commentMode.judgement.explanation[judgement]}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
