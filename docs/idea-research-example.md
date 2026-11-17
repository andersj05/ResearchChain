# Idea research example

An optional starting point for your own agent, requested by the owner on 2026-11-16.
It accepts your thesis, charts and documents, searches the live web, runs a small
numeric model when you supply data, and drafts a research memo for your judgment.
All prompts, wiring, code and checkpoints remain yours to change.

## First run

1. Open the saved **Idea research — charts to research memo** agent, or create an
   agent and select **Use idea research example** in Build.
2. Select **Run workflow**. Write what you see, your proposed mechanism, the asset/
   market, relevant dates, and what would change your mind in **Research brief**.
   Add/select your chart images, PDFs or text evidence. Choose a model from your
   existing ChatGPT connection. The example defaults to `gpt-6.1-sol`.
3. Start. **Frame my idea** reads the selected evidence and proposes questions.
   At **Choose research direction**, read its output and add your judgment before
   approving. Reject stops this run so you can revise it.
4. **Research support and objections** searches for dated primary sources and
   opposing explanations. Search queries can contain information from your brief
   and selected evidence; only enable web search for material you want researched
   externally. Inspect the saved web actions and source links in Research results.
5. **Calculate a simple model** runs the editable JavaScript below. Without numeric
   input it records a data gap. **Draft the research memo** combines the research
   and actual calculation results. Review both at the final checkpoint.
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
Paste reviewed numeric observations into the brief to enable reproducible math.
Without them, the memo proposes a quantitative test and specifies the missing data.

## Research boundaries

Three model requests: framing, one web-enabled research request, and synthesis.
The web request may perform multiple searches/page reads. The provider controls
that action count; the existing evidence-read allowance does not cap hosted web
actions. Each request has a 120-second timeout and bounded output. The example
allows 420 active seconds total and checks reported token use before another call.
Human review time does not consume active execution time. This is a focused
research pass; narrow the question or split it into more editable steps for depth.

Web search is an explicit custom-step checkbox, off by default on existing agents.
It uses the existing ChatGPT included-plan connection subject to model/account
policy. There is no paid API fallback. Unsupported tools, refusals, interrupted
responses, missing web activity and quota failures stop the attempt visibly.
Uncertain requests are not automatically repeated.

Web sources come from provider tool records and citation annotations, not URLs
invented in model prose. They are saved as references with the research result and
response artifact, separate from the original evidence library. The app does not
archive full web pages, guarantee their continued availability, or validate the
truth of the model's claims. Up to 100 actions and 200 URLs are retained; truncation
is marked. The memo receives a bounded subset if the source list is large; the
original research result keeps the full retained list. Open relevant links and
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
