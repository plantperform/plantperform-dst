"""Shared crop eligibility for scenario-level virkemidler."""

# SKH's 2026 faktaark limits præcisionsjordbrug to korn and raps. Maize and
# legumes are deliberately excluded even where source tables group them nearby.
KORN_OG_RAPS_KODER = frozenset({1, 2, 3, 10, 11, 14, 15, 22})
