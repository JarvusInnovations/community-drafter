import type { Capacity, Judgement, Signature, SignatureTrailer } from "@community-drafter/shared";
import { JUDGEMENTS } from "@community-drafter/shared";
import type { FastifyPluginAsync } from "fastify";

import { ApiError } from "../../errors.ts";
import { PARTICIPANT_ROUTE } from "../../gateway/gateway.ts";
import { findDraft } from "../../lib/drafts.ts";
import { mintSubmissionId } from "../../lib/ids.ts";
import { withIdempotency } from "../../lib/idempotency.ts";
import { buildSignatureView } from "../../lib/signature-view.ts";
import { buildSubmissionView } from "../../lib/submission-view.ts";
import { resolveVersion } from "../../lib/versions.ts";
import { assertPhase, type LifecycleAction } from "../../phase/phase.ts";
import { loadParticipantContext } from "./context.ts";

interface SubmitSignatureInput {
  capacity: Capacity;
  display_name: string;
  descriptor?: string;
  org?: string;
  title?: string;
  authorized?: boolean;
  listed?: boolean;
}

interface SubmitBody {
  version: number;
  judgement: Judgement;
  pending: number;
  reason?: string;
  signature?: SubmitSignatureInput;
}

const submitBodySchema = {
  type: "object",
  required: ["version", "judgement", "pending"],
  properties: {
    version: { type: "integer" },
    judgement: { type: "string", enum: [...JUDGEMENTS] },
    pending: { type: "integer", minimum: 0 },
    reason: { type: "string" },
    signature: {
      type: "object",
      required: ["capacity", "display_name"],
      properties: {
        capacity: { type: "string", enum: ["personal", "official"] },
        display_name: { type: "string", minLength: 1 },
        descriptor: { type: "string" },
        org: { type: "string" },
        title: { type: "string" },
        authorized: { type: "boolean" },
        listed: { type: "boolean" },
      },
    },
  },
} as const;

/**
 * `specs/behaviors/review-and-judgement.md` § Submission: "Submission with
 * comments is refused outside the commenting phase ... `decline` with no
 * comments and signature-only changes follow the sign/revoke rules." A
 * submission with any comments — regardless of judgement — is
 * `submit_with_comments` (commenting only); a comment-less submission
 * reuses whichever plain lifecycle action its judgement matches (`decline`
 * is allowed in commenting+signing; a comment-less `sign` is exactly a
 * normal signature; a comment-less `comment` or `sign_conditional` has
 * nothing to submit and is commenting-only like any other draft action).
 */
function phaseActionFor(judgement: Judgement, hasComments: boolean): LifecycleAction {
  if (hasComments) return "submit_with_comments";
  if (judgement === "decline") return "decline";
  if (judgement === "sign") return "sign";
  return "submit_with_comments";
}

/**
 * `specs/api/participant.md` § `POST submit`. One `Action: submit` commit
 * flips the draft (if any) to `submitted` with its judgement and, when the
 * judgement calls for it, changes the participation's `signature` in the
 * same commit (`specs/data-model.md`). Publishes the `submit` event so
 * `notifications` sends `review-receipt-<ts>` (`plans/comment-mode.md`).
 */
const submitRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: SubmitBody }>(
    "/submit",
    { config: PARTICIPANT_ROUTE, schema: { body: submitBodySchema } },
    async (request, reply) => {
      const { document, participation } = loadParticipantContext(fastify, request);

      return withIdempotency(
        fastify,
        request,
        reply,
        `submit:${participation.record.token}`,
        async () => {
          const body = request.body;
          if (body.pending > 0) {
            throw new ApiError(
              "unsaved_items",
              "Some of your comments haven't finished saving yet.",
              { pending: body.pending },
            );
          }

          const slug = document.record.slug;
          const person = participation.record.person;
          const draft = findDraft(fastify, slug, person);
          const hasComments = (draft?.record.comments?.length ?? 0) > 0;

          if (body.judgement === "sign_conditional" && !hasComments) {
            throw new ApiError(
              "judgement_requires_comments",
              "Signing conditionally requires at least one comment.",
            );
          }

          // `specs/api/conventions.md` § Versions: `version_stale` only
          // where a version older than the draft's declared version is
          // submitted against.
          if (draft && body.version < draft.record.version) {
            throw new ApiError(
              "version_stale",
              "Your draft has moved to a newer version; refresh before submitting.",
              { draft_version: draft.record.version },
            );
          }

          assertPhase(document.record, new Date(), phaseActionFor(body.judgement, hasComments));

          const version = draft
            ? draft.record.version
            : resolveVersion(document, body.version).number;

          const existingSignature = participation.record.signature;
          const hasLiveSignature =
            existingSignature !== undefined && existingSignature.revoked !== true;

          let signatureUpdate: Signature | undefined;
          // `specs/behaviors/signatures.md` § Signing: the `Signature`
          // trailer is what makes a signature written here read back as the
          // same sign/resign/revoke event as one written from the sign card
          // — which is where `signed_at` and friends come from.
          let signatureTrailer: SignatureTrailer | undefined;

          if (body.judgement === "sign" || body.judgement === "sign_conditional") {
            const conditional = body.judgement === "sign_conditional";
            if (hasLiveSignature && existingSignature) {
              // "Keep my signature" / "Make my signature conditional" — the
              // signature already in force is unchanged as a signature, so
              // this is not a new signature event. It is a re-affirmation
              // though: `specs/behaviors/signatures.md` § A signature
              // belongs to a version — a signer who submits with `sign` or
              // "keep" moves their name onto the version they submitted
              // against. Only ever forward: someone who kept commenting on
              // v2 while v3 was published has not seen v3, so submitting
              // against v2 must not drag a v3 signature backwards.
              const priorVersion = existingSignature.signed_on_version;
              signatureUpdate = {
                ...existingSignature,
                conditional,
                signed_on_version:
                  priorVersion === undefined || version > priorVersion ? version : priorVersion,
              };
            } else {
              const sig = body.signature;
              if (!sig) {
                throw new ApiError("validation_failed", "Signature details are required to sign.", {
                  field: "signature",
                });
              }
              const allowedCapacities = document.record.capacities ?? ["personal", "official"];
              if (!allowedCapacities.includes(sig.capacity)) {
                throw new ApiError(
                  "validation_failed",
                  "That signing capacity isn't offered for this document.",
                  { field: "capacity" },
                );
              }
              if (sig.capacity === "official") {
                if (!sig.org) {
                  throw new ApiError(
                    "validation_failed",
                    "An organization name is required for an official signature.",
                    { field: "org" },
                  );
                }
                if (sig.authorized !== true) {
                  throw new ApiError(
                    "attestation_required",
                    "You must attest that you are authorized to sign on behalf of your organization.",
                  );
                }
              }
              signatureUpdate = {
                capacity: sig.capacity,
                display_name: sig.display_name,
                descriptor: sig.descriptor,
                org: sig.capacity === "official" ? sig.org : undefined,
                title: sig.capacity === "official" ? (sig.title ?? "") : undefined,
                authorized: true,
                conditional,
                listed: sig.listed ?? true,
                display_approved: true,
                signed_on_version: version,
                revoked: false,
              };
              signatureTrailer = existingSignature?.revoked === true ? "resign" : "sign";
            }
          } else if (body.judgement === "decline" && hasLiveSignature && existingSignature) {
            signatureUpdate = { ...existingSignature, revoked: true };
            signatureTrailer = "revoke";
          }

          const id = draft?.record.id ?? mintSubmissionId(fastify, slug, person);
          const comments = draft?.record.comments ?? [];
          const reason = body.judgement === "decline" ? body.reason : undefined;

          const result = await fastify.storage.commit(
            "submit",
            {
              actor: { kind: "participant" },
              subject: `submit: ${person} on ${slug} v${version} (${body.judgement})`,
              document: slug,
              person,
              submission: id,
              version,
              judgement: body.judgement,
              signature: signatureTrailer,
              reason,
              requestId: request.requestId,
            },
            async (tx) => {
              await tx.submissions.upsert({
                document: slug,
                id,
                person,
                version,
                state: "submitted",
                judgement: body.judgement,
                reason,
                comments,
              });

              // `specs/behaviors/notifications.md` § Defaults: "reminders
              // default on ... until the person signs, comments, or
              // declines; then automatically off" — true of every judgement.
              const notify = { ...participation.record.notify, reminders: false };
              if (signatureUpdate) {
                await tx.participations.patch(
                  { document: slug, person },
                  { signature: signatureUpdate, notify },
                );
              } else {
                await tx.participations.patch({ document: slug, person }, { notify });
              }
            },
          );

          await fastify.events.publish({
            type: "submit",
            document: slug,
            person,
            commit: result.commitHash ?? "",
            submission: id,
            judgement: body.judgement,
          });

          const submissionEntry = fastify.storage.readModel.getSubmission(slug, id);
          const updatedParticipation = fastify.storage.readModel.getParticipation(slug, person);

          return {
            submission: submissionEntry ? buildSubmissionView(fastify, submissionEntry) : null,
            signature: updatedParticipation ? buildSignatureView(updatedParticipation) : null,
          };
        },
      );
    },
  );
};

export default submitRoute;
