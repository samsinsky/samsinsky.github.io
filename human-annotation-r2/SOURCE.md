# Reply-coding form, round 2 — generated, do not edit here

Round 2 asks whether a reply **criticises how someone behaved**, where round 1
asked whether it says they were **at fault**. Same 30 replies, same annotators.
Round 1 got Krippendorff alpha .89 on replies that name someone and .23 on the
85% that decline to; this round tests whether the second wording is codeable.

`index.html` is a build artifact copied from the `llm-sycophancy-emotion`
research repo. Editing it in this repo will be silently overwritten the next
time it is regenerated, and the change will not reach the study.

## Where it comes from

    llm-sycophancy-emotion/annotation/form_criticism.html

built by

    python3 scripts/build_annotation_set.py

No annotator names are needed. Each person's screen order is derived in the page
from the name they type, so anyone can be added without rebuilding, and two
people never share an order unless they enter the same name. That matters
because raters who share an order share their fatigue and scale-drift too, which
then reads as agreement rather than noise and inflates the study's reliability
figure. Each export records the name its order came from in `order_key`, and the
merge re-checks the property directly by comparing the screens people actually
saw.

## To refresh it

    cp llm-sycophancy-emotion/annotation/form_criticism.html human-annotation/index.html

Only do this **between** studies. Regenerating redraws the sample, which would
invalidate any labels already collected against the old one.

## What it is

A self-contained page: no network calls, no analytics, no server. Annotators'
progress lives in their own browser's localStorage and their labels leave only
as a file they download themselves. Nothing is transmitted anywhere, so hosting
it publicly exposes only the 30 AI-generated replies it shows.
