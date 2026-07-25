import { Router } from "express";
import {
  DEFAULT_POLICY_STATEMENT,
  getPolicy,
  setPolicy,
} from "../a2a/seller-executor.js";
import { openDatabase, type QueryRow } from "../data/db.js";
import { getBuyerAgentId, getSellerAgentId } from "../erc8004/agent-ids.js";
import { parsePolicy } from "../policy/parser.js";

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

  /** What the owner has earned, straight out of the negotiation ledger. */
  api.get("/earnings", (_req, res) => {
    const db = openDatabase();
    try {
      const rows = db
        .prepare("SELECT * FROM queries ORDER BY id DESC LIMIT 50")
        .all() as QueryRow[];

      const completed = rows.filter((row) => row.status === "completed");
      const totalEarnedHbar = completed.reduce((sum, row) => sum + row.price, 0);

      res.json({
        totalEarnedHbar: Number(totalEarnedHbar.toFixed(4)),
        completedCount: completed.length,
        declinedCount: rows.filter((row) => row.status === "declined").length,
        sales: rows.map((row) => ({
          id: row.id,
          buyerAgentId: row.buyer_agent_id,
          criteria: Object.values(JSON.parse(row.criteria)).join(", "),
          price: row.price,
          status: row.status,
          txHash: row.tx_hash,
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
