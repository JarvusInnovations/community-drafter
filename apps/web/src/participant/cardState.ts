import { type Bundle, type SignatureView } from "./types.ts";

export type CardState =
  | "not_signed"
  | "signed"
  | "signed_conditional"
  | "signed_final_pending"
  | "declined"
  | "closed";

/**
 * `specs/screens/document.md` § Display Rules 3 (the status card) as a
 * state machine over `{ phase, signature, position, draft }`
 * (`plans/participant-sign-flow.md` § Approach). `closed` always wins —
 * the card's own-outcome line inside that state further distinguishes
 * signed/declined/never-signed. Otherwise: an unrevoked signature is
 * `signed`, refined to `signed_final_pending` when a `final` version has
 * published since the signer's `signed_on_version`, or
 * `signed_conditional` when `signature.conditional` and no later final
 * exists yet; a `decline` position with no live signature is `declined`;
 * anything else is `not_signed`.
 */
export function computeCardState(bundle: Bundle): CardState {
  const { document, signature, position, versions } = bundle;

  if (document.phase === "closed") {
    return "closed";
  }

  if (signature && !signature.revoked) {
    const finalVersion = versions.find((v) => v.final);
    const predatesFinal =
      finalVersion !== undefined &&
      signature.signed_on_version !== undefined &&
      signature.signed_on_version < finalVersion.number;
    if (predatesFinal) {
      return "signed_final_pending";
    }
    if (signature.conditional) {
      return "signed_conditional";
    }
    return "signed";
  }

  if (position?.judgement === "decline") {
    return "declined";
  }

  return "not_signed";
}

/**
 * When a signature was given, as the signer should read it:
 * `specs/behaviors/signatures.md` § Signing — "it is the time of the commit
 * that put the signature currently in force — the `resign` commit, not the
 * superseded `sign` one." A signature that was never revoked has no
 * `resigned_at`, so this is just `signed_at` in the ordinary case (issue
 * #63: the card reported the first signature's time after a removal and a
 * re-signature).
 */
export function signatureTime(signature: SignatureView): string | undefined {
  const { signed_at: signedAt, resigned_at: resignedAt } = signature;
  if (resignedAt && (!signedAt || resignedAt >= signedAt)) {
    return resignedAt;
  }
  return signedAt ?? resignedAt;
}

export function currentDraftSubmission(bundle: Bundle) {
  return bundle.submissions.find((submission) => submission.state === "draft");
}
