# Working with a research team

Open the **Research desk** to assemble a source packet. **Methodology** opens an interactive map of the lead’s first reading, your decision and the assignments that follow.

## Start from a week of material

Drop a batch of charts, PDFs, text, Markdown, CSVs or TSVs into **Add material**,
or select several files at once. You can also paste a screenshot directly onto
the desk. Edit file titles in the queue before pinning. With a text file,
choose **Conversation** to identify a transcript. Each file has its own
receipt, so a failed file can be retried while the others stay pinned. After a
mixed drop, **Remove invalid files** clears the files that failed local
validation. A file with an unconfirmed pin stays queued for its exact retry.
Original uploads can overlap while the pins keep their queue order.

To look up another study while you assemble a packet, open **Studies** and
choose **Return to study setup** to keep working with the staged files in the
same tab. If a first reading was accepted during the visit, **Open study**
opens the confirmed session.

Use **Paste a source** for a note, conversation or reference URL. The **Source details** fields apply to uploads and pasted sources. Choose usage rights for files, notes and conversations, and add the author or speaker and observation date when known. Pin separately when attribution or rights differ.

Open **Preview chart** on a queued image to check it and edit its packet title
before pinning. Open a queued file's **File attribution** to set its own author or observation
date. Fields use batch attribution until edited. **Use batch attribution**
restores those defaults for the file.

**Saved sources** selects existing library records. Search by title or
attribution and choose **Pin loaded results** to append the matches on screen
in their current order. The action skips sources already pinned. Load more
matches to include them, or narrow the search if the group exceeds the packet's
remaining space.

The **Study packet** shows the reading order, previews and provenance. Select a
chart thumbnail to inspect its original and page through the other charts. Move
or unpin a source in the packet. **Unpin all** clears the packet for a new batch
and leaves the source library available. Use **Undo** to restore the previous
reading order. You can leave **Context for the lead** blank.

An optional **Study title** labels the session and its archive entry. The title stays separate from the context sent to the lead. With both fields empty, the first pinned source names the study. A revised study opens with the original title and allows a new one.

The library accepts originals up to 20 MiB each. A new desk study has an 8 MB limit for the complete model request, including encoded originals and instructions. The packet shows the minimum used by the source content. At launch, the server checks the serialized first-reading request before placing it in the queue. The analyst workspace can stage up to 64 files.

**Ask the lead for a first reading** uses one lead request to read the pinned
packet. Before anyone receives an assignment, the lead brings you an
observation, a question and up to two possible working sentences. Each proposal
names a rival explanation, its first check and what would weaken it. Follow a
source title to see the cited passage or chart. A sparse packet can yield a
question with no proposed sentence.

Choose **Use this sentence** to bring a proposal into **Your working sentence**.
Edit it or write your own. For example, a lead might suggest checking whether
a rally was concentrated in the largest stocks. If you expected firms with
near-term debt maturities to lead, write that expectation and specify the peers
you would compare. **Assign research** gives the planner and researchers your
exact wording alongside the original reading. **Issued assignments** shows what
the lead actually delegated. **Inspect researcher request** opens the saved
pass for that assignment.

**Park this study** ends the experiment before delegation. **Revisit material**
opens a new setup with the sources and settings from the original study. The
editorial review setting controls the separate decision about the report.

## Set up the study

- **Writing sample** accepts pasted text or a UTF-8 `.txt` or Markdown excerpt
  of up to 32,000 characters. Only the report editor receives it, as a reference
  for structure and voice.
- Turn on **Allow live web search** if the team and editor should look beyond the
  packet after you choose a working sentence. The packet sidebar shows the
  first-reading model and the current web-search setting.
- **Research settings** starts with up to three researchers, six passes per
  researcher and editor, and a 30-minute active-time limit. You can choose up to
  four researchers, twelve passes and one hour. The lead can use fewer researchers
  or finish earlier. Check the selected model and account before starting.
- **Editorial review** defaults to **When the team asks**. Choose **Before the report**
  for a guaranteed editorial checkpoint, or **Continue independently** to let the
  editor proceed after research.

The **Ask the lead for a first reading** action stays in view as you edit the
packet and settings. **Recent research** lists the latest studies. Open
**Studies** in the header to search by title, any pinned source title, context
or ID. **Decisions** opens working sentences, lead questions and editorial
reviews even after a study drops out of the recent list.

When you open a study from the archive, the same tab remembers your submitted
search, status filter and results page. **Reset search** clears the filters and
returns to the first page.

### Choose the model and thinking effort

Under **Research settings**, the **Research model**, **Thinking effort** and
**Response detail** apply to the whole study. New studies start at **High**
on each slider where the model offers that level. Move a slider or use its
arrow keys to choose a supported level. Thinking effort controls how much reasoning
the model can do. Response detail controls how much detail it gives in its
answer. Each slider can also use the model's own default.

Open **Models by role** to configure the **Research lead**, **Researchers** or
**Report editor**. New single-lead and swarm studies use Astra 6.2 for lead
work and Sol 6.2 for researchers. The editor uses the shared research model,
which starts at Sol 6.2 when the connected account offers it.
Each role inherits the two slider settings independently. You can adjust a
single role, restore its shared setting, or use its model default. If a model
or level is unavailable on the connected account, the desk identifies which
choice needs attention.

During a study, **Sources and settings** shows the model, effort and detail
pinned for each role. The same panel lists sources in pinned order. It retrieves
titles and authors for matching source versions and keeps the study’s recorded
dates and availability. A workspace's **Model passes** includes the saved
request for each pass. **Revisit material** restores your choices for the next
experiment.

### Run a swarm

Under **Research settings**, change **Team structure** to **Research swarm**.

Choose up to four leads and up to twenty researcher assignments per lead.
The parallel limit controls how many leads or researchers can work at once
across the study. For example, two leads can each assign twenty researchers
while four agents work at a time. Set the parallel limit to twenty to permit
twenty simultaneous agents. The request ceiling includes the coordinator,
lead turns, researcher passes and report editor. The workspace's rolling
request allowance still applies.

The coordinator gives each lead a distinct mandate. Expand a lead to inspect
its assignments, requests, files and findings. A lead can delegate a follow-up
after reading what its researchers found. With expert consultations enabled,
it can present a trade thesis and ask an open-ended question or propose
alternatives. Inspect the supporting work, then select a suggestion or write
your own answer. The answer goes back to the lead while it can still revise
the investigation. Open **Recorded expert perspectives** to see the assignments
issued on the lead's next turn and inspect their researcher requests.
The editorial review setting controls the later report
checkpoint independently.

## Follow and direct the investigation

The lead's saved plan lists each assignment and its objective. Select a researcher
under **Workspaces** to see the current request, saved leads, web activity, Python
results and files as they arrive. Researchers can use the same filename in their
own workspaces. Open an earlier pass or an activity entry to inspect the request
and response that produced it. The reader shows the findings, files and sources
recorded for that pass, and the link remembers the workspace and pass. Choose
**Inspect pass in Runs** to see structured request inputs, or **Back to latest
workspace** to continue following the workspace. **Copy study link** opens the
study from its overview. **Copy pass link** points to the exact structured
receipt in Runs.

Use **Search study activity** in the **Activity log** to find a pass by
workspace, lead, pass number, result text or filename. The log keeps the search
in place while you inspect a matching receipt. **Back to activity** returns to
the originating row.

**Saved files** searches across assignments and leads. Each file lists its
producing pass and content ID. If an assignment saved another version under
the same filename, both versions stay available. Preview a file or open the
saved pass that produced it, then choose **Back to saved files** to resume the
same search.

Use **Guide the team** to send a course correction while research is underway.
Each researcher and the editor receive it when preparing their next request.
Expand a saved direction to see exactly which requests included it. Once the
editor starts, the current study closes to further directions.

If the session pauses for review, read the team's question and inspect the work
behind it. Open **Research behind this review** to inspect a saved final pass.
Researchers who raised the current question appear first. **Back to editorial
review** returns to your drafted answer. You can give the editor your judgment
or end the study at that point.

## Read the result and iterate

Choose **Read report** at the top of a completed study to open its saved
Markdown and figures. Longer reports show a **Contents** list with links to
individual headings. A report section can be bookmarked and reopened directly.
**Focus reading** gives the report the full workspace while keeping the current
paragraph in view. Choose **Exit reading** or press Escape inside the report to
return to the workspaces.
**Download report and files** packages the Markdown and the editor's saved files
in a ZIP. Individual researcher files remain available from their own workspaces.
Choose **Edit in Reports** to create an editable report from the saved Markdown
with the figures, the original study and its recorded sources attached. Confirm
the title and a style guide before creating the draft. Further edits and editorial
feedback belong to the report's saved revisions. [Reports and editorial review](reports.md).

Choose **Revisit material** beside the study title to start another experiment
with the previous context, sample, sources and settings. Before starting, open **Compare with previous
setup** to see packet changes, reading order, model roles, limits and context.
In the revised study, **Compare with baseline** opens the original alongside the
revision in the run inspector. Use **Open research session** to return to the
revision. To read the original by itself, choose **Open baseline session** under
**Sources and settings**.
