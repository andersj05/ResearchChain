# Try the idea generation demo

The demo takes a market observation, pitches several explanations, and pauses for
you to choose one. A Codex analyst can then look up sources, write and run Python,
inspect its results, and revise its analysis before returning a chart and memo.
You can edit the prompts, tools, budgets and review points in Build.

## Start an experiment

1. Open **New agent** in Build. Under **Starting workflow**, select **Idea
   generation demo**. Keep the suggested name or enter your own, then choose
   **Create agent**. You can also select an existing copy in the **Agent** menu.
2. Choose **Run workflow**. The starter brief includes twelve weeks of invented
   returns for two baskets and a benchmark. It asks whether the apparent shift in
   leadership persists after accounting for one unusual week. Use it as supplied,
   or replace it with your own question, series and sources. To restore the sample
   in a workspace-enabled workflow, clear the brief and choose **Use synthetic
   rotation brief**.
3. Pick an available model from the connected ChatGPT plan and choose **Start
   run**. The scout can consult the web before proposing ideas. At **Pick an idea
   to test**, read its shortlist, enter your direction and choose **Approve and
   continue** to commission the analysis. For the sample, try “Compare leadership
   before and after February 20. Show how the result changes if you exclude that
   week, and tell me what additional data could distinguish the explanations.”
4. Select **Investigate and chart the evidence** in the run graph to inspect its
   work. The demo asks for `rotation.png`, `observations.csv` and `memo.md`. Each
   executed Python action retains its source as `analysis.py`. The memo should
   identify the dates and units, show which test it ran, explain contrary evidence
   and state where the data fall short. If the source table is unavailable, the
   analyst can explain what it needs to produce a chart.
5. At **Review the chart and memo**, record what you would change. Approve to
   finish or reject to stop. Choose **Iterate from this run** and put any feedback
   you want applied into the next brief or step instructions. A new run pins your
   revised workflow and inputs.

## Depth and tools

The research step allows up to 30 model passes. The shared run budget allows 31
model requests, up to five minutes per response, 45 minutes of active execution,
and one million cumulative tokens. Human review pauses the active timer. The
agent can finish early, and a budget or provider limit can end the experiment.
Select the investigation in Build to change its analyst instructions and passes.
To have the connected model work from the brief and selected evidence alone,
set **Web and market search** to **Off** on both research steps.

Python uses NumPy, Matplotlib and the standard library in the worker's local
container. Hosted web search is available to the analyst separately. The agent
can carry source values into Python, run a comparison, read its numerical output
and call Python again to refine the chart or report. The worker retains the
returned files on their corresponding run steps. The research quality and the
decision to pursue an idea are yours to assess.

The [importable workflow](../examples/idea-generation.json) and
[sample brief and observations](../examples/idea-generation-brief.json) are
included in the repository.
