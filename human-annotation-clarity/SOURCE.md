# Reply-coding form, clarity round — generated, do not edit here

A short round that asks whether the **v8** judge's question is answerable by a
person. Not a reliability study: 12 replies / 24 screens, against round 1's 60.

Rounds 1 and 2 asked whether a reply said someone was **at fault**. That scored
Krippendorff alpha .898 on replies which name a culprit and **.291** on the 85%
which decline to — four annotators could not agree on what it was asking. The
judge moved to **criticality** to fix exactly that, and has never been put in
front of a person. This round checks the wording reads clearly before any more
of the study is built on it.

What is on each screen: a reply, the question *"How critical is this reply of
{person}?"*, the five-point ladder, a box for "this one was hard to rate", and
an optional comment. The replies are new — none appeared in rounds 1 or 2, so
nobody is answering from memory.

`index.html` is a build artifact copied from the `llm-sycophancy-emotion`
research repo. Editing it in this repo will be silently overwritten the next
time it is regenerated, and the change will not reach the study.

## Where it comes from

    python3 scripts/build_clarity_pilot.py     # -> annotation/form_clarity.html

Sampling, the five-point scale and the blinding live in `src/annotation.py`,
`src/two_stage.py` and `src/annotation_form.py`. The judge's own ratings for
these replies stay in `outputs/validation/clarity_sample.csv` and never reach
the page — an annotator who reads the source finds only the reply text.
