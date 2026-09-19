import type { FastifyInstance } from "fastify";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function randomSuffix(): string {
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += BASE62[Math.floor(Math.random() * BASE62.length)];
  }
  return out;
}

/** `specs/data-model.md` → `submissions.id`: `<person>-<4 base62>`, unique within the document. */
export function mintSubmissionId(
  fastify: FastifyInstance,
  document: string,
  person: string,
): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = `${person}-${randomSuffix()}`;
    if (!fastify.storage.readModel.getSubmission(document, id)) return id;
  }
  throw new Error("mintSubmissionId: exhausted retries without finding a free id");
}
