import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const config = JSON.parse(
  readFileSync(new URL("../.github/repository-settings.json", import.meta.url), "utf8"),
);
const apply = process.argv.includes("--apply");

function api(method, path, body) {
  const args = ["api", "--method", method, path];
  if (body !== undefined) args.push("--input", "-");
  const result = spawnSync("gh", args, {
    input: body === undefined ? undefined : JSON.stringify(body),
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? result.stderr);
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

function ruleset(branch) {
  return {
    name: `ResearchChain ${branch}`,
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: { ref_name: { include: [`refs/heads/${branch}`], exclude: [] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: true,
          allowed_merge_methods: branch === "main" ? ["merge"] : ["merge", "squash"],
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [{ context: "ci", integration_id: 15368 }],
          // Main accepts only dev promotions. CI tests the proposed merge result;
          // requiring dev to contain main's promotion commit creates a sync PR loop.
          strict_required_status_checks_policy: branch === "dev",
          do_not_enforce_on_create: false,
        },
      },
    ],
  };
}

const plans = [ruleset("main"), ruleset("dev")];
if (!apply) {
  console.log(JSON.stringify({ ...config, rulesets: plans }, null, 2));
  console.log(
    "Dry run only. Pass --apply to reconcile these settings, labels, milestones, and rulesets.",
  );
  process.exit(0);
}

const base = `repos/${config.repository}`;
api("PATCH", base, config.settings);
api("PUT", `${base}/vulnerability-alerts`);
const labels = api("GET", `${base}/labels?per_page=100`);
for (const label of config.labels) {
  const exists = labels.some((item) => item.name === label.name);
  api(
    exists ? "PATCH" : "POST",
    exists ? `${base}/labels/${encodeURIComponent(label.name)}` : `${base}/labels`,
    label,
  );
}
const milestones = api("GET", `${base}/milestones?state=all&per_page=100`);
for (const milestone of config.milestones) {
  const existing = milestones.find((item) => item.title === milestone.title);
  const saved = api(
    existing ? "PATCH" : "POST",
    existing ? `${base}/milestones/${existing.number}` : `${base}/milestones`,
    milestone,
  );
  console.log(`Milestone ${saved.number}: ${saved.title}`);
}
const existingRules = api("GET", `${base}/rulesets?per_page=100`);
for (const plan of plans) {
  const existing = existingRules.find((item) => item.name === plan.name);
  const saved = api(
    existing ? "PUT" : "POST",
    existing ? `${base}/rulesets/${existing.id}` : `${base}/rulesets`,
    plan,
  );
  console.log(`Ruleset ${saved.id}: ${saved.name} (${saved.enforcement})`);
}
console.log(
  "Repository configuration reconciled. Repository visibility and default branch were not changed.",
);
