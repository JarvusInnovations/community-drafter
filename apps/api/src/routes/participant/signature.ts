import type { Capacity, Signature } from "@signatories/shared";
import type { FastifyPluginAsync } from "fastify";

import { ApiError } from "../../errors.ts";
import { PARTICIPANT_ROUTE } from "../../gateway/gateway.ts";
import { withIdempotency } from "../../lib/idempotency.ts";
import { buildSignatureView, effectiveSignedVersion } from "../../lib/signature-view.ts";
import { resolveVersion } from "../../lib/versions.ts";
import { assertPhase } from "../../phase/phase.ts";
import { loadParticipantContext } from "./context.ts";

interface SignatureBody {
  capacity: Capacity;
  display_name: string;
  descriptor?: string;
  org?: string;
  title?: string;
  authorized?: boolean;
  listed?: boolean;
  version?: number;
}

interface SignaturePatchBody {
  display_name?: string;
  descriptor?: string;
  org?: string;
  title?: string;
  authorized?: boolean;
  listed?: boolean;
  confirm?: boolean;
}

interface RevokeBody {
  reason?: string;
}

const signatureBodySchema = {
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
    version: { type: "integer" },
  },
} as const;

const signaturePatchBodySchema = {
  type: "object",
  properties: {
    display_name: { type: "string" },
    descriptor: { type: "string" },
    org: { type: "string" },
    title: { type: "string" },
    authorized: { type: "boolean" },
    listed: { type: "boolean" },
    confirm: { type: "boolean" },
  },
} as const;

/**
 * The display fields "Change how you're listed" edits
 * (`specs/behaviors/signatures.md` § Changing how a signature is listed) —
 * a patch that moves any of them is a listing edit and sends
 * `listing-changed-<ts>`.
 */
const LISTING_FIELDS = ["display_name", "descriptor", "org", "title", "listed"] as const;

/** The text display fields a listing edit can set or clear. */
const TEXT_FIELDS = ["display_name", "descriptor", "org", "title"] as const;
type TextField = (typeof TEXT_FIELDS)[number];

/**
 * Each text field of a PATCH body as an edit: `undefined` when omitted
 * (unchanged), `null` when present but blank after trimming (cleared),
 * otherwise the trimmed value.
 */
function normaliseTextFields(
  body: SignaturePatchBody,
): Record<TextField, string | null | undefined> {
  const edits = {} as Record<TextField, string | null | undefined>;
  for (const field of TEXT_FIELDS) {
    const value = body[field];
    edits[field] = value === undefined ? undefined : value.trim() || null;
  }
  return edits;
}

/** An edit applied to a stored optional value: omitted keeps it, cleared drops it. */
function pick(edit: string | null | undefined, current: string | undefined): string | undefined {
  if (edit === undefined) return current;
  return edit ?? undefined;
}

function notSigned(): ApiError {
  return new ApiError("not_found", "You have not signed this document.");
}

const signatureRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: SignatureBody }>(
    "/signature",
    { config: PARTICIPANT_ROUTE, schema: { body: signatureBodySchema } },
    async (request, reply) => {
      const { document, participation } = loadParticipantContext(fastify, request);

      return withIdempotency(
        fastify,
        request,
        reply,
        `signature:${participation.record.token}`,
        async () => {
          assertPhase(document.record, new Date(), "sign");
          const body = request.body;

          const allowedCapacities = document.record.capacities ?? ["personal", "official"];
          if (!allowedCapacities.includes(body.capacity)) {
            throw new ApiError(
              "validation_failed",
              "That signing capacity isn't offered for this document.",
              { field: "capacity" },
            );
          }
          const officialTitle = body.title?.trim() ?? "";
          if (body.capacity === "official") {
            if (!body.org) {
              throw new ApiError(
                "validation_failed",
                "An organization name is required for an official signature.",
                { field: "org" },
              );
            }
            if (officialTitle.length === 0) {
              // `specs/behaviors/signatures.md` § Capacity: "Official
              // capacity requires a title" — a bare name under an
              // organization's name tells a reader nothing about the
              // standing of the person who gave the signature.
              throw new ApiError(
                "validation_failed",
                "Your title is required when you sign for an organization.",
                { field: "title" },
              );
            }
            if (body.authorized !== true) {
              throw new ApiError(
                "attestation_required",
                "You must attest that you are authorized to sign on behalf of your organization.",
              );
            }
          }

          const wasRevoked = participation.record.signature?.revoked === true;
          const action = wasRevoked ? "resign" : "sign";
          const version = body.version ?? resolveVersion(document).number;
          const person = participation.record.person;
          const slug = document.record.slug;

          const signature: Signature = {
            capacity: body.capacity,
            display_name: body.display_name,
            descriptor: body.descriptor,
            org: body.capacity === "official" ? body.org : undefined,
            title: body.capacity === "official" ? officialTitle : undefined,
            authorized: true,
            conditional: false,
            listed: body.listed ?? true,
            display_approved: true,
            signed_on_version: version,
            revoked: false,
          };

          const result = await fastify.storage.commit(
            action,
            {
              actor: { kind: "participant" },
              subject: `${action}: ${person} on ${slug}`,
              document: slug,
              person,
              version,
              requestId: request.requestId,
            },
            async (tx) => {
              // `specs/behaviors/notifications.md` § Defaults: reminders default
              // "on ... until the person signs, comments, or declines; then
              // automatically off."
              await tx.participations.patch(
                { document: slug, person },
                { signature, notify: { ...participation.record.notify, reminders: false } },
              );
            },
          );

          await fastify.events.publish({
            type: action,
            document: slug,
            person,
            commit: result.commitHash ?? "",
          });

          const updated = fastify.storage.readModel.getParticipation(slug, person);
          return buildSignatureView(updated!);
        },
      );
    },
  );

  fastify.patch<{ Body: SignaturePatchBody }>(
    "/signature",
    { config: PARTICIPANT_ROUTE, schema: { body: signaturePatchBodySchema } },
    async (request, reply) => {
      const { document, participation } = loadParticipantContext(fastify, request);

      return withIdempotency(
        fastify,
        request,
        reply,
        `signature-patch:${participation.record.token}`,
        async () => {
          assertPhase(document.record, new Date(), "sign");
          const current = participation.record.signature;
          if (!current || current.revoked) throw notSigned();

          const body = request.body;
          const person = participation.record.person;
          const slug = document.record.slug;

          // `specs/behaviors/signatures.md` § A signature belongs to a
          // version: re-affirming — "Keep my name" against a newer version,
          // or "Confirm my signature" on the final one — moves the
          // signature onto the current version and clears `conditional`.
          // An edit to how the signature is listed leaves it where it is.
          // A record written before the field existed keeps deriving it
          // from the trailer rather than being rewritten to carry it, so
          // the stored value only ever changes here on a re-affirmation.
          const reaffirming = body.confirm === true;
          const signedOnVersion = reaffirming
            ? resolveVersion(document).number
            : effectiveSignedVersion(participation);

          // `specs/api/participant.md` § PATCH: a text field omitted from
          // the body is unchanged; one present and blank after trimming is
          // cleared — removed from the record, not kept at its old value
          // (issue #116: the form dropped an emptied descriptor, and a
          // bare `??` merge could not tell "cleared" from "unchanged").
          const edits = normaliseTextFields(body);
          if (edits.display_name === null) {
            throw new ApiError("validation_failed", "Your name is required.", {
              field: "display_name",
            });
          }
          const signature: Signature = {
            ...current,
            display_name: edits.display_name ?? current.display_name,
            descriptor: pick(edits.descriptor, current.descriptor),
            org: pick(edits.org, current.org),
            title: pick(edits.title, current.title),
            listed: body.listed ?? current.listed,
            conditional: reaffirming ? false : current.conditional,
            signed_on_version: reaffirming ? signedOnVersion : current.signed_on_version,
          };

          if (current.capacity === "official") {
            if (edits.org === null) {
              throw new ApiError(
                "validation_failed",
                "An organization name is required for an official signature.",
                { field: "org" },
              );
            }
            // `specs/behaviors/signatures.md` § Changing how a signature is
            // listed: the organization is the claim the signature makes
            // about authority, so swapping it is a new claim and needs the
            // attestation again. An unchanged organization does not.
            const orgChanged =
              signature.org !== undefined && signature.org !== (current.org ?? "").trim();
            if ((orgChanged || body.authorized === false) && body.authorized !== true) {
              throw new ApiError(
                "attestation_required",
                orgChanged
                  ? "Confirm that you are authorized to sign on behalf of the organization you named."
                  : "You must attest that you are authorized to sign on behalf of your organization.",
              );
            }
            if ((signature.title ?? "").trim().length === 0) {
              throw new ApiError(
                "validation_failed",
                "Your title is required when you sign for an organization.",
                { field: "title" },
              );
            }
          }

          // § Changing how a signature is listed: a listing edit sends the
          // signer a confirmation; a bare re-affirmation changes no display
          // field and sends nothing.
          const listingChanged = LISTING_FIELDS.some(
            (field) => signature[field] !== current[field],
          );

          const result = await fastify.storage.commit(
            "sign",
            {
              actor: { kind: "participant" },
              subject: reaffirming
                ? `sign: ${person} on ${slug} (reaffirmed v${signedOnVersion ?? "?"})`
                : `sign: ${person} on ${slug} (updated)`,
              document: slug,
              person,
              version: signedOnVersion,
              requestId: request.requestId,
            },
            async (tx) => {
              // RFC 7396 merge patch: an absent key keeps the stored value,
              // so a cleared field is sent as `null`, which deletes it.
              const cleared = Object.fromEntries(
                TEXT_FIELDS.filter((field) => edits[field] === null).map((field) => [field, null]),
              );
              await tx.participations.patch(
                { document: slug, person },
                { signature: { ...signature, ...cleared } },
              );
            },
          );

          const updated = fastify.storage.readModel.getParticipation(slug, person);

          if (listingChanged) {
            await fastify.events.publish({
              type: "listing-changed",
              document: slug,
              person,
              commit: result.commitHash ?? "",
            });
          }

          return buildSignatureView(updated!);
        },
      );
    },
  );

  fastify.delete<{ Body: RevokeBody }>(
    "/signature",
    { config: PARTICIPANT_ROUTE },
    async (request, reply) => {
      const { document, participation } = loadParticipantContext(fastify, request);

      return withIdempotency(
        fastify,
        request,
        reply,
        `signature-revoke:${participation.record.token}`,
        async () => {
          assertPhase(document.record, new Date(), "revoke_signature");
          const current = participation.record.signature;
          if (!current || current.revoked) throw notSigned();

          const person = participation.record.person;
          const slug = document.record.slug;
          const reason = request.body?.reason;

          const result = await fastify.storage.commit(
            "revoke",
            {
              actor: { kind: "participant" },
              subject: `revoke: ${person} on ${slug}`,
              document: slug,
              person,
              reason,
              requestId: request.requestId,
            },
            async (tx) => {
              await tx.participations.patch(
                { document: slug, person },
                { signature: { ...current, revoked: true } },
              );
            },
          );

          await fastify.events.publish({
            type: "revoke",
            document: slug,
            person,
            commit: result.commitHash ?? "",
            reason,
          });

          const updated = fastify.storage.readModel.getParticipation(slug, person);
          return buildSignatureView(updated!);
        },
      );
    },
  );
};

export default signatureRoute;
