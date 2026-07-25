import "dotenv/config";
import { ChatGroq } from "@langchain/groq";
import { createAgent } from "langchain";
import { createSellerClient } from "../src/hedera/clients.js";
import { createSellerToolkit } from "../src/hedera/agentkit.js";

/**
 * First proof that the seller agent can act on Hedera by reasoning rather than
 * by us calling the SDK: the LLM is handed the Agent Kit tools and asked a
 * question it can only answer by picking the balance-query tool and running it
 * against the seller's account.
 *
 *   npx tsx scripts/test-agent-kit.ts
 */

const MODEL = "llama-3.3-70b-versatile";
const QUESTION = "What's my HBAR balance?";

/**
 * Handing the model all 43 core tools costs ~54k tokens of schema per request,
 * which blows through Groq's free-tier limit of 12k tokens/minute. The agent is
 * given the account-query tools only — it still has to choose between them, but
 * the request stays inside the free tier.
 */
const ACCOUNT_QUERY_TOOLS = [
  "get_hbar_balance_query_tool",
  "get_account_query_tool",
  "get_account_token_balances_query_tool",
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name} — get a free key at https://console.groq.com/keys and add it to .env.`,
    );
  }
  return value;
}

async function main(): Promise<void> {
  const apiKey = requireEnv("GROQ_API_KEY");
  const client = createSellerClient();

  try {
    const toolkit = createSellerToolkit(client);
    const allTools = toolkit.getTools();
    const tools = allTools.filter((tool) => ACCOUNT_QUERY_TOOLS.includes(tool.name));

    const agent = createAgent({
      model: new ChatGroq({ model: MODEL, apiKey, temperature: 0 }),
      tools,
      systemPrompt:
        "You are the seller agent for a personal fitness-data marketplace, operating a Hedera testnet account. " +
        "Use the available tools to answer questions about that account instead of guessing. " +
        "Keep answers to one short sentence.",
    });

    console.log(`Model:    ${MODEL}`);
    console.log(`Account:  ${client.operatorAccountId!.toString()}`);
    console.log(
      `Tools:    ${tools.length} of ${allTools.length} (${tools.map((t) => t.name).join(", ")})`,
    );
    console.log(`Question: ${QUESTION}\n`);

    const result = await agent.invoke({
      messages: [{ role: "user", content: QUESTION }],
    });

    // Showing which tools ran is what distinguishes a real tool call from the
    // model inventing a plausible-looking balance.
    const toolCalls = result.messages.filter((m) => m.getType() === "tool");
    for (const call of toolCalls) {
      console.log(`[tool] ${call.name}: ${String(call.content).slice(0, 200)}`);
    }

    const answer = result.messages.at(-1);
    console.log(`\nAnswer: ${answer?.text ?? ""}`);

    if (toolCalls.length === 0) {
      console.log("\nFAILED — the agent answered without calling any tool");
      process.exitCode = 1;
    }
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error("Agent Kit test failed:", error);
  process.exit(1);
});
