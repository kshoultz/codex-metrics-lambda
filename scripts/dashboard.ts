/**
 * Terminal dashboard — fetches Codex metrics and displays a formatted summary.
 *
 * Usage:
 *   cp .env.example .env   # add your API key
 *   npm run dashboard
 */

import { config } from "dotenv";
config();

import { handler } from "../src/index.js";

// ── ANSI helpers ────────────────────────────────────────────────────
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

function bar(pct: number, width = 20): string {
  const filled = pct > 0 ? Math.max(1, Math.round((pct / 100) * width)) : 0;
  const empty = width - filled;
  const color = pct < 50 ? green : pct < 80 ? yellow : red;
  return color("█".repeat(filled)) + dim("░".repeat(empty));
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function shortModel(model: string): string {
  return model
    .replace("gpt-", "")
    .replace("-20250514", "");
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const result = await handler();

  if (result.statusCode !== 200) {
    console.error(`Error (${result.statusCode}):`, result.body);
    process.exit(1);
  }

  const data = JSON.parse(result.body);
  const bp = data.billing_period;
  const api = data.capacity.openai_api;
  const codex = data.capacity.codex_cli;
  const cost = data.cost;
  const usage = data.usage.openai_api;

  const W = 48;
  const line = "─".repeat(W);
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));

  console.log("");
  console.log(`┌${line}┐`);
  console.log(`│ ${bold("Codex Metrics")}${" ".repeat(W - 14)}│`);
  console.log(`│ ${dim(`Day ${Math.floor(bp.days_elapsed)} of ${bp.days_total}`)}${" ".repeat(Math.max(0, W - 11 - String(Math.floor(bp.days_elapsed)).length - String(bp.days_total).length))}│`);
  console.log(`├${line}┤`);

  // Token capacity
  const tokLine = `${fmtTokens(api.tokens_used)} / ${fmtTokens(api.token_limit)}`;
  const burnLine = `${fmtTokens(api.daily_burn_rate)}/day → ${fmtTokens(api.projected_tokens_at_period_end)} projected`;
  console.log(`│ ${bold("API TOKENS")}  ${bar(api.usage_pct)}  ${api.usage_pct}%${" ".repeat(Math.max(0, W - 37 - String(api.usage_pct).length))}│`);
  console.log(`│ ${pad(tokLine, W - 1)}│`);
  console.log(`│ ${pad(dim(burnLine), W - 1)}│`);

  if (api.days_until_exhaustion != null) {
    const exLine = red(`⚠ ${api.days_until_exhaustion} days until exhaustion`);
    console.log(`│ ${pad(exLine, W - 1)}│`);
  }

  // Codex CLI capacity
  if (codex) {
    console.log(`├${line}┤`);
    const codexTok = `${fmtTokens(codex.tokens_used)} / ${fmtTokens(codex.token_limit)}`;
    console.log(`│ ${bold("CODEX CLI")}  ${bar(codex.usage_pct)}  ${codex.usage_pct}%${" ".repeat(Math.max(0, W - 36 - String(codex.usage_pct).length))}│`);
    console.log(`│ ${pad(codexTok, W - 1)}│`);
    for (const u of (codex.per_user ?? []).slice(0, 5)) {
      const userLine = `  ${u.name}: ${fmtTokens(u.tokens_used)}`;
      console.log(`│ ${pad(dim(userLine), W - 1)}│`);
    }
  }

  // Cost
  console.log(`├${line}┤`);
  const costLine = `${fmtUsd(cost.current_spend_usd)} spent → ${fmtUsd(cost.projected_spend_usd)} projected`;
  console.log(`│ ${bold("COST")}${" ".repeat(W - 5)}│`);
  console.log(`│ ${pad(costLine, W - 1)}│`);
  console.log(`│ ${pad(dim(`${fmtUsd(cost.daily_burn_rate_usd)}/day`), W - 1)}│`);

  // Cost by line item
  if (cost.by_line_item?.length > 0) {
    for (const li of cost.by_line_item.slice(0, 5)) {
      const liLine = `  ${pad(li.line_item, 28)} ${fmtUsd(li.cost_usd)}`;
      console.log(`│ ${pad(dim(liLine), W - 1)}│`);
    }
  }

  // Top models by usage
  console.log(`├${line}┤`);
  console.log(`│ ${bold("TOP MODELS")}${" ".repeat(W - 11)}│`);
  for (const m of usage.by_model.slice(0, 5)) {
    const mLine = `  ${pad(shortModel(m.model), 30)} ${fmtTokens(m.tokens)}`;
    console.log(`│ ${pad(mLine, W - 1)}│`);
  }

  // Account
  console.log(`├${line}┤`);
  const numProjects = data.account.projects?.length ?? 0;
  const numMembers = data.account.members?.length ?? 0;
  console.log(`│ ${pad(dim(`${numMembers} member${numMembers !== 1 ? "s" : ""} • ${numProjects} project${numProjects !== 1 ? "s" : ""} • resets ${bp.resets_at.slice(0, 10)}`), W - 1)}│`);

  console.log(`└${line}┘`);
  console.log("");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
