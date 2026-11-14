import { readFileSync } from "node:fs";

if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
  console.log("Branch routing applies to pull requests.");
  process.exit(0);
}

const { pull_request: pr, repository } = JSON.parse(
  readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"),
);
const feature = pr.base.ref === "dev" && /^feat\/[a-z0-9][a-z0-9-]*$/.test(pr.head.ref);
const dependency =
  pr.base.ref === "dev" &&
  pr.head.ref.startsWith("dependabot/") &&
  pr.user.login === "dependabot[bot]";
const promotion =
  pr.base.ref === "main" &&
  pr.head.ref === "dev" &&
  pr.head.repo.full_name === repository.full_name;

if (!feature && !dependency && !promotion) {
  console.error(
    "Use feat/<feature-name> → dev, or the repository's dev → main. Dependabot targets dev.",
  );
  process.exit(1);
}
console.log(`Valid branch route: ${pr.head.ref} → ${pr.base.ref}`);
