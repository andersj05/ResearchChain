# Step research tools

Accepted 2026-11-17 after the owner’s first Idea Research run needed current issuer information during framing.

Custom model steps can choose whether to use hosted web search, require a completed search or disable it. The step’s pinned instructions and its provider request share the same search policy. Optional search can finish from the evidence already in context. An attempted search with no completed action fails visibly. Existing saved workflows with required search keep their original policy and prompt hash.

The SEC financial statements option adds one nullable lookup request to the model’s output schema. The model selects a ticker and financial metric. The worker resolves the ticker through the SEC directory, reads the corresponding USD concept from EDGAR, and records the observed values, periods and filing accessions with the model attempt. Connected graph steps receive this receipt. A missing contact, unavailable issuer or failed request produces an explicit gap. The server owns all receipt fields and constructs both destinations. The model’s raw answer and server receipt are saved together.

This design supports company financials within one admitted inference per model step. A step that needs to interpret those values connects its output to a downstream model or calculation. Recovery reuses a completed attempt and stops on an uncertain attempt. Each SEC-enabled execution can make one lookup (two bounded HTTP reads) after validating the model response. The worker sends the operator’s declared contact only to SEC endpoints. [SEC data APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) and [SEC fair-access guidance](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data).

The included-plan connection supplies hosted web search and provider-observed finance feeds subject to model and account support. Local numerical work remains in the graph’s existing bounded code step. [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search) and [included-plan tool support](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
