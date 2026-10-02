# Activity analysis

The Python activity module builds source-cited summaries from selected session events. `pipeline.py` groups events and `jev.py` decides when a meaningful change needs analysis. `coordination.py` prepares bounded two-session input for the Flower adapter.

The backend's project-wide event sequence is evidence identity. It stays separate from a thread's activity revision and a work-card version. The producer preserves exact source references; model output cannot supply owners, membership, consent, or execution status.

This module does not authenticate an export or deliver a result. The combined product's backend captures permitted events and repeats consent/currentness checks before saving or admitting returned findings. See [the integration setup](../README.md).

The standard-library checks run from the integration directory with `uv run python -m unittest discover`. Synthetic activity inputs under `fixtures/activity` support those checks and are not product presence or execution data.
