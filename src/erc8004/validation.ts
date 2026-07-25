import { keccak256, toUtf8Bytes } from "ethers";
import { logAuditEvent } from "../hedera/audit.js";
import { createSellerClient } from "../hedera/clients.js";
import { toHashScanTransactionId } from "../x402/pay.js";
import { getApprovedAgentIds } from "./agent-ids.js";
import { createSellerWallet } from "./wallets.js";

/**
 * Compliance attestations for buyer agents.
 *
 * ERC-8004 defines a ValidationRegistry for exactly this — a validator publishes
 * a verdict about an agent that anyone can read back. **It has no live
 * deployment on any chain:** the official deployment list covers only the
 * Identity and Reputation registries, because the validation section of the spec
 * is still under active revision with the TEE community. `abis/ValidationRegistry.json`
 * is an interface with no bytecode and no address behind it.
 *
 * So the attestation is recorded on Hedera Consensus Service instead, using the
 * registry's own vocabulary — `validatorAddress`, `agentId`, `requestURI`,
 * `requestHash`, `response`, `responseURI`, `responseHash`, `tag`. The record is
 * public, ordered and tamper-evident, and when the registry does ship, moving to
 * it is a change of substrate rather than a redesign.
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
  agentId: string;
  validatorAddress: string;
  /** What the validator is being asked to confirm. */
  claim: string;
  requestedAt: string;
}

export interface ValidationResponseDocument {
  tag: string;
  agentId: string;
  validatorAddress: string;
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

const hashDocument = (document: object): string =>
  keccak256(toUtf8Bytes(JSON.stringify(document)));

/** The address acting as validator — the seller's own EVM identity. */
export function validatorAddress(): string {
  return createSellerWallet().address;
}

/**
 * Opens a validation request for an agent.
 *
 * Mirrors `validationRequest(validatorAddress, agentId, requestURI, requestHash)`.
 * The document is hashed so the record stays checkable even though the URI
 * travels inline.
 */
export async function requestValidation(agentId: string): Promise<ValidationWrite> {
  if (!/^\d+$/.test(agentId)) {
    throw new Error(`Invalid agent id: ${agentId}`);
  }

  const document: ValidationRequestDocument = {
    tag: VALIDATION_TAG,
    agentId,
    validatorAddress: validatorAddress(),
    claim: "Agent is authorised to receive aggregated health and fitness data.",
    requestedAt: new Date().toISOString(),
  };

  const requestHash = hashDocument(document);
  const client = createSellerClient();

  try {
    const write = await logAuditEvent(client, {
      event: "validation_request",
      validatorAddress: document.validatorAddress,
      agentId,
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
  agentId: string,
): Promise<ValidationResponseWrite> {
  const approved = getApprovedAgentIds().includes(agentId);
  const response = approved ? SCORE_COMPLIANT : SCORE_NON_COMPLIANT;

  const document: ValidationResponseDocument = {
    tag: VALIDATION_TAG,
    agentId,
    validatorAddress: validatorAddress(),
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
      validatorAddress: document.validatorAddress,
      agentId,
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
export async function attestCompliance(agentId: string): Promise<Attestation> {
  const request = await requestValidation(agentId);
  const response = await respondValidation(request.requestHash, agentId);

  return {
    requestHash: request.requestHash,
    response: response.response,
    compliant: response.response >= SCORE_COMPLIANT,
    requestTransactionId: request.transactionId,
    responseTransactionId: response.transactionId,
    hashscanUrl: response.hashscanUrl,
  };
}
