# Idea research example

An optional starting point for your own agent, requested by the owner on 2026-11-16.
It accepts your thesis, charts and documents, researches current information,
retrieves company financial statements and drafts a memo for your judgment.
All prompts, wiring, code and checkpoints remain yours to change.

## First run

1. Create an agent and select **Use idea research example** in Build. If you
   already have a saved copy and want to use the revised template there, export or
   save your edits first, load the example, and save a new version. Runs keep the
   workflow version they started with.
2. Select **Run workflow**. Write what you see, your proposed mechanism, the asset/
   market, relevant dates, and what would change your mind in **Research brief**.
   Add/select your chart images, PDFs or text evidence. Choose a model from your
   existing ChatGPT connection. The example defaults to `gpt-6.1-sol`.
3. Start. **Frame my idea** proposes two or three testable ideas from your brief
   and evidence. It can search for current prices and request annual SEC figures
   when they would help you pick an idea. The filing receipt appears alongside
   the framing output. At **Choose research direction**, inspect the sources and
   choose which idea to pursue. Include the ticker and metric if the follow-up
   needs a filing comparison.
4. **Research support and objections** uses the Codex analyst after you approve
   a direction. It can look for dated primary sources, check an objection, follow
   a lead and finish early when it has enough evidence. Select this step in Build
   to edit its **Analyst skill**, research tools and **Maximum research passes**.
   Web queries can include material from the brief and selected evidence.
5. **Calculate a simple model** compares the two latest available annual SEC
   periods from the approved research step. It reports both values, the absolute
   change, and the percentage change when the prior value is positive. Paired
   observations in your brief take precedence and run OLS. **Draft the research
   memo** uses the saved research and calculation results. Review both at the
   final checkpoint.
6. Approve to finish, or reject and iterate. Final-review feedback is saved; it does
   not trigger another model call. Use **Iterate from this run**, edit the prompts/
   brief or code, save a version and start another run to apply it.

## Optional numeric model

Paste one `research-data` block in the brief with your own aligned observations.
The values below are **synthetic arithmetic examples, not financial evidence**:

````text
My idea: investigate whether X is associated with Y, and why that relationship might fail.

```research-data
{
  "source": "Synthetic demonstration — replace with your actual data source",
  "as_of": "2026-11-16",
  "basis": "supplied_numeric",
  "x_label": "X",
  "x_unit": "units",
  "y_label": "Y",
  "y_unit": "units",
  "observations": [
    { "period": "A", "x": 1, "y": 3 },
    { "period": "B", "x": 2, "y": 5 },
    { "period": "C", "x": 3, "y": 7 }
  ],
  "scenario_x": [2, 4]
}
```
````

This produces slope 2, intercept 1, correlation 1, and scenario values 5 and 9.
The second scenario is marked as extrapolation. The code accepts 3–500 distinct
paired periods and up to 12 explicit x scenarios, subject to the 10,000-character
brief limit (including your prose and JSON). It rejects missing values,
numeric strings, duplicate periods and constant x. Constant y has an undefined
correlation. Use `basis: "estimate"` for estimated inputs. Provenance is your
assertion, not independent verification. Exact inputs, code hash and outputs are
saved in the run's code event.

The baseline is ordinary least squares with an intercept and Pearson correlation.
It is descriptive, not a causal estimate or validated forecast. Time-series levels,
small samples, inconsistent units, confounders and selection bias can mislead.
It does not align lags, detrend, assess stationarity or validate out of sample.
Replace the calculation step with your preferred analysis as you iterate.

Charts/PDFs are model-interpreted evidence. The example does not automatically
convert chart pixels, attached tables or web prose into verified numeric data.
The calculation records a data gap if neither usable filings nor paired inputs are available.

## Company filings

Enable **SEC financial statements** on a custom step and connect its text output to
another model or code step. The model chooses a ticker and one annual metric
(revenue, net income, operating income or operating cash flow), or skips the
lookup. The worker fetches the selected SEC XBRL concept and attaches up to five
annual USD observations to that step’s result. Each record includes the reporting
period, value, filing date, form and accession. When financials are restated, the
latest filing for the period wins. Market prices use web and market search.
The example enables an optional lookup in both research steps. The framing receipt
informs the first review. The lookup after approval supplies any filing comparison.

Set `RESEARCHCHAIN_SEC_USER_AGENT` in the worker environment or local `.env` to
your organization’s name and monitored contact email, then restart the worker.
The SEC receives this header with the ticker index and concept requests. Search
and other steps can still run when SEC access or data is unavailable. Inspect
the SEC receipt for the reason. Coverage is limited to the supported US-GAAP
concepts in USD on 10-K or amended 10-K filings. [SEC data APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
and [SEC fair access](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data).

## Reading and repeating a run

Open a run in **Runs** to see the graph from its saved version. It follows the
active step and brings a pending review into focus. At a checkpoint, read the
previous step's output, enter feedback, and approve or reject. Select a node or
use **Inspect step** to open an earlier result, its sources, or the feedback you
gave. **Return to review** takes you back to the decision. **Run context** holds
the original brief, evidence and research manifest.

**Run workflow** shows the cumulative token budget. New workflows start at
1,000,000 tokens. A fixed total counts provider-reported input and output across
all steps. A response can cross the total before the next request is stopped.
Choose **As needed** to let the run keep using tokens under its request and time
limits. The model's context window and the size of each response still apply.

For an older agent with a small fixed budget, choose **Iterate from this run**
and open **Run workflow**. Choose **Use 1,000,000 tokens**, enter your own total
or select **As needed**. Starting the experiment pins the revised settings to
a fresh run with the brief and evidence carried forward.

## Research limits

The example allows up to four passes in its analyst step, plus framing and memo
synthesis. Each pass can use hosted searches and page reads. The provider controls
the count of these web actions. ResearchChain checks its model request allowance
before each inference. The example allows 300 seconds per response and 1,200
seconds of active execution in total. Owners can set **Seconds per response** up
to 600. Time spent waiting for human review is excluded.

The analyst requires the Codex CLI on the worker's PATH. Each analyst step opens
an isolated local app-server session. ResearchChain supplies the selected model
through its existing ChatGPT plan connection and records each pass. The step
inspector shows the findings, follow-up question and provider-reported sources.
An existing custom research step can use this mode by enabling **Codex analyst**
and supplying an **Analyst skill**. [Codex app-server and the ChatGPT plan](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)

In a custom step, set **Web and market search** to **Off**, **Let the model
decide** or **Require a search**. The provider can use its finance feed when
available. Required search must produce a completed search action. Optional
search permits an answer from the supplied evidence alone. Unsupported tools,
refusals, interrupted responses and quota failures stop the attempt visibly.
Uncertain requests are not automatically repeated.

Web sources come from provider tool records and citation annotations, not URLs
invented in model prose. They are saved as references with the research result and
response artifact, separate from the original evidence library. The app does not
archive full web pages, guarantee their continued availability, or validate the
truth of the model's claims. Up to 100 actions and 200 URLs are retained; truncation
is marked. The memo receives a bounded list that prioritizes provider-cited sources,
plus the reported feeds and search observation time. The research output keeps
the full retained list. Open relevant links and
attach important originals yourself when reproducibility requires them.

## Files and verification

- [Workflow JSON](../examples/idea-research.json): importable, editable example.
- [Calculation source](../examples/idea-research-analytics.js): function body embedded
  in the example's code step; edit the step in the app for your saved agent.
- Synthetic tests cover arithmetic, data rejection, source provenance, checkpoints,
  restart recovery, and failure when a provider returns no completed search.
- A bounded live public-documentation check verified the existing plan route's
  streamed web activity and strict JSON output. This does not establish research
  quality; that remains for the owner to assess with real ideas.

Provider references: [web search](https://developers.openai.com/api/docs/guides/tools-web-search)
and [ChatGPT token-sharing preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
