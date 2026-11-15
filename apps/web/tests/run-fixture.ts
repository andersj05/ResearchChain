import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";

export async function runRequest(
  request: APIRequestContext,
  path: string,
  options?: Parameters<APIRequestContext["post"]>[1],
): Promise<APIResponse> {
  const response = await request.post(path, options);
  if (response.status() !== 202) return response;
  const receipt = await response.json();
  expect(Object.keys(receipt).sort()).toEqual(["accepted_at", "command_id", "kind", "run_id"]);
  let snapshot: APIResponse | undefined;
  await expect
    .poll(
      async () => {
        snapshot = await request.get(`/api/runs/${receipt.run_id}`);
        expect(snapshot.status()).toBe(200);
        const current = await snapshot.json();
        return current.execution_pending || ["queued", "running"].includes(current.status);
      },
      { timeout: 30000, intervals: [100, 250, 500] },
    )
    .toBe(false);
  return snapshot!;
}
