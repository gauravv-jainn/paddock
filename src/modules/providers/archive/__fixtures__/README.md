# Adapter fixtures — structural only

These files exist to exercise the archive adapter's parsing, normalisation and
capability enforcement. The tracks, horses, prices and finishing orders in them
are **invented placeholders**, deliberately named so they cannot be mistaken
for racing data.

They are not racing data and they are not evidence of anything about
settlement. The grader for settlement is `tests/golden/`, which is assembled by
hand from real historical results — see `tests/golden/README.md`.

Never copy a value out of this directory into a golden vector.
