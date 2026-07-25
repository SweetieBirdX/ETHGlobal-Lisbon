import { Router, type Response } from "express";
import { negotiateAndPurchase } from "../a2a/buyer-client.js";
import {
  DEFAULT_POLICY_STATEMENT,
  getPolicy,
  setPolicy,
} from "../a2a/seller-executor.js";
import { openDatabase, type QueryRow } from "../data/db.js";
import { getBuyerAgentId, getSellerAgentId } from "../erc8004/agent-ids.js";
import { parsePolicy } from "../policy/parser.js";
import { toHashScanTransactionId } from "../x402/pay.js";

/**
 * The panel's backend.
 *
 * Everything here reads or writes the same state the agents use — there is no
 * separate demo copy — so what the screen shows is what the seller agent will
 * actually do with the next offer it receives.
 */

/** Longest policy we will send to the model. */
const MAX_POLICY_LENGTH = 2_000;

/** The statement the owner last typed, so the form can show it back. */
let currentStatement = DEFAULT_POLICY_STATEMENT;

export function getCurrentStatement(): string {
  return currentStatement;
}

const MIRROR_NODE = "https://testnet.mirrornode.hedera.com";

interface MirrorTopicMessage {
  sequence_number: number;
  consensus_timestamp: string;
  message: string;
}

export interface AuditEntry {
  sequenceNumber: number;
  /** Consensus time, as an ISO string. */
  timestamp: string;
  /** `json` = written by this app, `text` = written by the Agent Kit hook. */
  kind: "json" | "text";
  summary: string;
  payload: unknown;
}

/**
 * Turns one topic message into something displayable.
 *
 * The topic carries two shapes: the JSON entries this app writes, and the
 * plain-text lines the Hedera Agent Kit's audit hook writes. Both are real
 * history, so the view has to read both rather than assume its own format.
 */
function toAuditEntry(message: MirrorTopicMessage): AuditEntry {
  const text = Buffer.from(message.message, "base64").toString("utf8");
  const seconds = Number(message.consensus_timestamp.split(".")[0]);
  const timestamp = new Date(seconds * 1000).toISOString();

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const event = String(parsed["event"] ?? "event");
    const detail = [
      parsed["buyerAgentId"] ? `buyer #${parsed["buyerAgentId"]}` : "",
      // Compliance attestations name the subject `agentId`, matching the
      // ValidationRegistry's own field names.
      parsed["agentId"] ? `agent #${parsed["agentId"]}` : "",
      parsed["response"] !== undefined ? `score ${parsed["response"]}` : "",
      parsed["priceHbar"] !== undefined ? `${parsed["priceHbar"]} ℏ` : "",
      parsed["criteria"] ? JSON.stringify(parsed["criteria"]) : "",
    ]
      .filter(Boolean)
      .join(" · ");

    return {
      sequenceNumber: message.sequence_number,
      timestamp,
      kind: "json",
      summary: detail ? `${event} — ${detail}` : event,
      payload: parsed,
    };
  } catch {
    // The hook writes multi-line prose; the first line carries the substance.
    return {
      sequenceNumber: message.sequence_number,
      timestamp,
      kind: "text",
      summary: text.split("\n")[0]!.trim().slice(0, 160),
      payload: text,
    };
  }
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** "running, 25-34" — the cohort as a person would describe it. */
function describeCriteria(json: string): string {
  const parsed = safeParse(json);
  return [parsed["activityType"], parsed["ageRange"]].filter(Boolean).join(", ");
}

/**
 * Waits for the post-payment chain to mark a query completed.
 *
 * The audit and reputation writes are Hedera transactions that run after the
 * buyer already has its data, so the only honest way to report them is to look.
 */
async function waitForCompletion(queryId: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const db = openDatabase();
    try {
      const row = db
        .prepare("SELECT status FROM queries WHERE id = ?")
        .get(queryId) as { status: string } | undefined;
      if (row?.status === "completed") return true;
    } finally {
      db.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  return false;
}

export function createApiRouter(): Router {
  const api = Router();

  /** Who the agents are, and the policy currently in force. */
  api.get("/status", async (_req, res) => {
    try {
      res.json({
        sellerAgentId: getSellerAgentId(),
        buyerAgentId: getBuyerAgentId(),
        policyStatement: currentStatement,
        policy: await getPolicy(),
        network: "hedera:testnet",
      });
    } catch (error) {
      res.status(500).json({ error: String(error).slice(0, 200) });
    }
  });

  /**
   * Replaces the owner's policy from a sentence typed in the form.
   *
   * The parsed result is returned so the owner can see exactly what their words
   * were understood to mean before an agent starts trading on them.
   */
  api.post("/policy", async (req, res) => {
    const statement = typeof req.body?.statement === "string" ? req.body.statement.trim() : "";

    if (!statement) {
      res.status(400).json({
        error: "Describe what you are willing to sell — the policy cannot be empty.",
      });
      return;
    }

    if (statement.length > MAX_POLICY_LENGTH) {
      res.status(400).json({
        error: `Policy is ${statement.length} characters; keep it under ${MAX_POLICY_LENGTH}.`,
      });
      return;
    }

    try {
      const policy = await parsePolicy(statement);
      // Only adopt the new policy once it has parsed: a failed parse must leave
      // the previous rules in force rather than disarming the agent.
      setPolicy(policy);
      currentStatement = statement;

      res.json({ policyStatement: statement, policy });
    } catch (error) {
      res.status(502).json({
        error: `Could not interpret that policy: ${String(error).slice(0, 200)}`,
      });
    }
  });

  /**
   * Runs one full negotiation and streams it as it happens.
   *
   * Server-sent events rather than a single response, because the point of the
   * demo is the *sequence* — identity checked, policy applied, payment signed,
   * data released, trail written — not the final answer.
   */
  api.get("/negotiate", async (req, res) => {
    const category = String(req.query["category"] ?? "running");
    const price = Number(req.query["price"] ?? 0.5);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // Stops proxies (and some browsers) from holding the stream back.
      "X-Accel-Buffering": "no",
    });

    const send = (type: string, payload: Record<string, unknown> = {}) => {
      res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
    };

    // If the operator closes the tab mid-negotiation, stop writing to a dead
    // socket — the payment itself is already beyond our control by then.
    let open = true;
    req.on("close", () => {
      open = false;
    });

    try {
      send("step", {
        who: "buyer →",
        text: `offers ${price} ℏ for ${category} cohort data`,
      });

      const result = await negotiateAndPurchase({ category }, price, {
        onStep: (message) => {
          if (!open) return;
          const kind = message.includes("HTTP 402")
            ? "payment"
            : message.includes("signed by")
              ? "payment"
              : "";
          send("step", { who: message.startsWith("negotiation") ? "seller →" : "x402", text: message, kind });
        },
      });

      const { negotiation, purchase } = result;

      send("decision", {
        who: "seller →",
        decision: negotiation.decision,
        reason: negotiation.reason,
        text: negotiation.reply,
        kind: negotiation.decision === "accept" ? "accept" : "decline",
      });

      if (negotiation.decision !== "accept") {
        send("done", {
          // The refusal is noted in the owner's own ledger, but nothing was
          // paid and nothing went on-chain — say exactly that.
          text: "No payment, no HCS entry, no reputation write — the refusal is logged for the owner only.",
          kind: "decline",
        });
        res.end();
        return;
      }

      send("payment", {
        who: "hedera",
        text: `settled ${purchase?.settlement?.transaction} — ${purchase?.settlement?.hashscanUrl}`,
        kind: "payment",
        hashscanUrl: purchase?.settlement?.hashscanUrl,
      });

      send("data", {
        who: "buyer ←",
        text: `received aggregate ${JSON.stringify(purchase?.data)}`,
        data: purchase?.data,
        kind: "accept",
      });

      // The audit and reputation writes happen after the buyer has its data,
      // so the panel waits for them rather than claiming they are done.
      send("step", { who: "seller", text: "writing HCS audit entry and ERC-8004 feedback…" });

      const queryId = Number(
        new URL(negotiation.payment!.url).searchParams.get("queryId") ?? 0,
      );
      const completed = await waitForCompletion(queryId, 45_000);

      if (completed) {
        send("chain", {
          who: "hedera",
          text: `audit trail and reputation recorded — query #${queryId} marked completed`,
          kind: "accept",
        });
      } else {
        send("chain", {
          who: "hedera",
          text: `still settling — query #${queryId} has not been marked completed yet`,
          kind: "",
        });
      }

      send("done", { text: "Negotiation complete.", kind: "accept" });
    } catch (error) {
      send("error", { who: "error", text: String(error).slice(0, 240), kind: "decline" });
    } finally {
      res.end();
    }
  });

  /**
   * The public audit trail, read from Hedera rather than from our own records.
   *
   * This is the check a sceptic should make: the panel does not show what the
   * app *thinks* happened, it shows what the consensus service recorded, pulled
   * back through the mirror node — the same source HashScan renders.
   */
  api.get("/audit", async (_req, res) => {
    const topicId = process.env.HCS_AUDIT_TOPIC_ID;

    if (!topicId) {
      res.status(503).json({
        error:
          "HCS_AUDIT_TOPIC_ID is not set — run `npx tsx scripts/create-audit-topic.ts` and add it to .env.",
      });
      return;
    }

    try {
      const response = await fetch(
        `${MIRROR_NODE}/api/v1/topics/${topicId}/messages?order=desc&limit=25`,
        { signal: AbortSignal.timeout(15_000) },
      );

      if (!response.ok) {
        res.status(502).json({
          error: `Mirror node responded ${response.status} for topic ${topicId}.`,
        });
        return;
      }

      const body = (await response.json()) as { messages?: MirrorTopicMessage[] };

      res.json({
        topicId,
        hashscanUrl: `https://hashscan.io/testnet/topic/${topicId}`,
        entries: (body.messages ?? []).map(toAuditEntry),
      });
    } catch (error) {
      res.status(502).json({
        error: `Could not reach the mirror node: ${String(error).slice(0, 160)}`,
      });
    }
  });

  /**
   * What the owner has earned, straight out of the negotiation ledger.
   *
   * `sales` lists completed sales only — money actually received. Refusals are
   * counted separately rather than mixed into the table, because "what the
   * agent turned down" is a different claim from "what the owner was paid".
   */
  api.get("/earnings", (_req, res) => {
    const db = openDatabase();
    try {
      const rows = db
        .prepare("SELECT * FROM queries ORDER BY id DESC LIMIT 100")
        .all() as QueryRow[];

      const completed = rows.filter((row) => row.status === "completed");
      const declined = rows.filter((row) => row.status === "declined");
      const totalEarnedHbar = completed.reduce((sum, row) => sum + row.price, 0);

      res.json({
        totalEarnedHbar: Number(totalEarnedHbar.toFixed(4)),
        completedCount: completed.length,
        declinedCount: declined.length,
        sales: completed.map((row) => ({
          id: row.id,
          buyerAgentId: row.buyer_agent_id,
          criteria: describeCriteria(row.criteria),
          price: row.price,
          status: row.status,
          txHash: row.tx_hash,
          hashscanUrl: row.tx_hash
            ? `https://hashscan.io/testnet/transaction/${toHashScanTransactionId(row.tx_hash)}`
            : null,
          createdAt: row.created_at,
        })),
        declines: declined.slice(0, 10).map((row) => ({
          id: row.id,
          buyerAgentId: row.buyer_agent_id,
          criteria: describeCriteria(row.criteria),
          price: row.price,
          reason: safeParse(row.criteria)["declineReason"] ?? "policy",
          createdAt: row.created_at,
        })),
      });
    } catch (error) {
      res.status(500).json({ error: String(error).slice(0, 200) });
    } finally {
      db.close();
    }
  });

  return api;
}
