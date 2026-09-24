import { type Bundle, type SignatureView } from "./types.ts";

export type CardState = "not_signed" | "signed" | "signed_conditional" | "declined" | "closed";

/**
 * `specs/screens/document.md` § Display Rules 3 (the status card) as a
 * state machine over `{ phase, signature, position, draft }`
 * (`plans/participant-sign-flow.md` § Approach). `closed` always wins —
 * the card's own-outcome line inside that state further distinguishes
 * signed/declined/never-signed. Otherwise: an unrevoked signature is
 * `signed`, or `signed_conditional` when `signature.conditional`; a
 * `decline` position with no live signature is `declined`; anything else is
 * `not_signed`. There is no "final" version to wait for
 * (`specs/behaviors/versioning.md` § No version is "final").
 */
export function computeCardState(bundle: Bundle): CardState {
  const { document, signature, position } = bundle;

  if (document.phase === "closed") {
    return "closed";
  }

  if (signature && !signature.revoked) {
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

/**
 * `specs/behaviors/signatures.md` § A signature belongs to a version: a live
 * signature attached to a version older than the document's current one is
 * *behind*, and the card says so. The current version is the newest in
 * `versions`, not `bundle.version` — the latter is whichever version is
 * being read, and reading an older one does not move anyone's signature.
 * `null` when there is nothing to say: no live signature, no version
 * recorded for it, or it is already on the current text.
 */
export interface SignatureDrift {
  signedVersion: number;
  currentVersion: number;
}

export function signatureDrift(bundle: Bundle): SignatureDrift | null {
  const { signature, versions, version } = bundle;
  if (!signature || signature.revoked) return null;
  const signedVersion = signature.signed_on_version;
  if (signedVersion === undefined) return null;
  const currentVersion = versions.reduce((max, v) => Math.max(max, v.number), version.number);
  if (signedVersion >= currentVersion) return null;
  return { signedVersion, currentVersion };
}

export function currentDraftSubmission(bundle: Bundle) {
  return bundle.submissions.find((submission) => submission.state === "draft");
}
