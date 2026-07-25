import { createHash } from "node:crypto";
import { logAuditEvent } from "../hedera/audit.js";
import { createSellerClient } from "../hedera/clients.js";
import { toHashScanTransactionId } from "../x402/pay.js";
import { getApprovedUaids, getSellerUaid } from "./agent-ids.js";
import { parseUaid } from "./uaid.js";

/**
 * Compliance attestations for buyer agents.
 *
 * ERC-8004 defines a ValidationRegistry for exactly this — a validator publishes
 * a verdict about an agent that anyone can read back. We avoid it twice over:
 * **it has no live deployment on any chain** (the official deployment list
 * covers only the Identity and Reputation registries, because the validation
 * section of the spec is still under active revision with the TEE community),
 * and **this project is now deliberately EVM-free** — identity, reputation and
 * attestation all live on Hedera-native services.
 *
 * So the attestation is recorded on Hedera Consensus Service, using the
 * registry's own vocabulary — `validatorUaid`, `agentUaid`, `requestURI`,
 * `requestHash`, `response`, `responseURI`, `responseHash`, `tag`. The record is
 * public, ordered and tamper-evident, and if a validation registry ever ships,
 * moving to it is a change of substrate rather than a redesign.
 *
 * **The validator is the seller itself.** There is no independent auditor in
 * this demo, so an attestation here proves that the check ran and what it
 * decided — it is not third-party verification, and nothing should describe it
 * as such.
 */

/** The claim being attested: this agent may receive health-related data. */
export const VALIDATION_TAG = "healthDataCompliance";

/** Verdict for an agent the data owner has vetted. */
export const SCORE_COMPLIANT = 100;
/** Verdict for one it has not. */
export const SCORE_NON_COMPLIANT = 0;

export interface ValidationRequestDocument {
  tag: string;
  agentUaid: string;
  validatorUaid: string;
  /** What the validator is being asked to confirm. */
  claim: string;
  requestedAt: string;
}

export interface ValidationResponseDocument {
  tag: string;
  agentUaid: string;
  validatorUaid: string;
  /** 0-100, mirroring the registry's `uint8 response`. */
  response: number;
  /** Why the verdict came out that way. */
  reason: string;
  respondedAt: string;
}

export interface ValidationWrite {
  /** Ties the response to its request, as the registry's `bytes32` does. */
  requestHash: string;
  sequenceNumber: number;
  transactionId: string;
  hashscanUrl: string;
}

export interface ValidationResponseWrite extends ValidationWrite {
  response: number;
  responseHash: string;
}

/** Attestation attached to an identity check, for the reply and the trail. */
export interface Attestation {
  requestHash: string;
  response: number;
  compliant: boolean;
  requestTransactionId: string;
  responseTransactionId: string;
  hashscanUrl: string;
}

function toDataUri(document: object): string {
  const base64 = Buffer.from(JSON.stringify(document), "utf8").toString("base64");
  return `data:application/json;base64,${base64}`;
}

/** sha256, 0x-hex — keccak only existed here for EVM alignment. */
const hashDocument = (document: object): string =>
  `0x${createHash("sha256").update(JSON.stringify(document), "utf8").digest("hex")}`;

/** The UAID acting as validator — the seller's own identity. */
export function validatorUaid(): string {
  return getSellerUaid();
}

/**
 * Opens a validation request for an agent.
 *
 * Mirrors `validationRequest(validatorAddress, agentId, requestURI, requestHash)`.
 * The document is hashed so the record stays checkable even though the URI
 * travels inline.
 */
export async function requestValidation(agentUaid: string): Promise<ValidationWrite> {
  parseUaid(agentUaid); // throws on malformed input

  const document: ValidationRequestDocument = {
    tag: VALIDATION_TAG,
    agentUaid,
    validatorUaid: validatorUaid(),
    claim: "Agent is authorised to receive aggregated health and fitness data.",
    requestedAt: new Date().toISOString(),
  };

  const requestHash = hashDocument(document);
  const client = createSellerClient();

  try {
    const write = await logAuditEvent(client, {
      event: "validation_request",
      validatorUaid: document.validatorUaid,
      agentUaid,
      requestURI: toDataUri(document),
      requestHash,
      tag: VALIDATION_TAG,
    });

    return {
      requestHash,
      sequenceNumber: write.sequenceNumber,
      transactionId: write.transactionId,
      hashscanUrl: `https://hashscan.io/testnet/transaction/${toHashScanTransactionId(write.transactionId)}`,
    };
  } finally {
    client.close();
  }
}

/**
 * Publishes the verdict for an open request.
 *
 * Mirrors `validationResponse(requestHash, response, responseURI, responseHash, tag)`.
 * The decision rule is the data owner's vetted list — being registered on-chain
 * proves an agent exists, which is a different question from whether the owner
 * is willing to sell to it.
 */
export async function respondValidation(
  requestHash: string,
  agentUaid: string,
): Promise<ValidationResponseWrite> {
  const approved = getApprovedUaids().includes(agentUaid);
  const response = approved ? SCORE_COMPLIANT : SCORE_NON_COMPLIANT;

  const document: ValidationResponseDocument = {
    tag: VALIDATION_TAG,
    agentUaid,
    validatorUaid: validatorUaid(),
    response,
    reason: approved
      ? "Agent holds a compliance attestation for health data from the data owner."
      : "Agent is not on the data owner's list of vetted recipients for health data.",
    respondedAt: new Date().toISOString(),
  };

  const responseHash = hashDocument(document);
  const client = createSellerClient();

  try {
    const write = await logAuditEvent(client, {
      event: "validation_response",
      validatorUaid: document.validatorUaid,
      agentUaid,
      requestHash,
      response,
      responseURI: toDataUri(document),
      responseHash,
      tag: VALIDATION_TAG,
    });

    return {
      requestHash,
      response,
      responseHash,
      sequenceNumber: write.sequenceNumber,
      transactionId: write.transactionId,
      hashscanUrl: `https://hashscan.io/testnet/transaction/${toHashScanTransactionId(write.transactionId)}`,
    };
  } finally {
    client.close();
  }
}

/**
 * Runs a full request/response cycle and returns the verdict.
 *
 * Both halves are written: a verdict with no recorded request is not an audit
 * trail, and the failing case is the one worth being able to prove afterwards.
 */
export async function attestCompliance(agentUaid: string): Promise<Attestation> {
  const request = await requestValidation(agentUaid);
  const response = await respondValidation(request.requestHash, agentUaid);

  return {
    requestHash: request.requestHash,
    response: response.response,
    compliant: response.response >= SCORE_COMPLIANT,
    requestTransactionId: request.transactionId,
    responseTransactionId: response.transactionId,
    hashscanUrl: response.hashscanUrl,
  };
}
