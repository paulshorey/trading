**Research provenance and access limits, November 3, 2026.**

The standard Parallel Search helper completed both batches. The deep-research task
was created once and completed successfully. Bounded local polling timeouts did not
cancel or duplicate it. The completed report, exact brief, and source URLs are saved
beside this file; see [provenance](2026-11-03-provenance.json).

The [reviewed findings](2026-11-03-reviewed-findings.md) separate inspected evidence,
engineering recommendations, and hypotheses. The [Parallel report](2026-11-03-parallel-report.md)
is supporting provider-generated research; its confidence assessment is not independent
validation. Its original body is preserved, apart from Markdown formatting and the
repository navigation notice.

| Source or fetch                                                                                              | Access and implication                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Bramante et al., 2019](https://onlinelibrary.wiley.com/doi/10.1002/sam.11411)                               | Publisher abstract verified. The full-text link redirected to the abstract. No claims about its exact test or second-scale futures performance are established. |
| [A note on online change point detection](https://www.tandfonline.com/doi/abs/10.1080/07474946.2023.2276170) | Web fetch returned HTTP 403 Forbidden. No reviewed conclusion depends on inaccessible full text from this page.                                                 |
| [Gaussian Process Change Point Models](https://mlg.eng.cam.ac.uk/pub/pdf/SaaTurRas10.pdf)                    | Follow-up web fetch returned HTTP 502 Bad Gateway. No detailed claims about that paper are included in the reviewed findings.                                   |

Other primary papers and official documentation linked in the reviewed findings were
inspected through web fetches, including abstracts where sufficient for the stated
limited claim. No detector/model packages were installed or runtime-tested, and no
market benchmark was run. An isolated research CLI was used outside the repository;
its environment and credentials are not part of this archive.

The provenance export preserves task identifiers and source URLs. Raw API metadata,
bulk search excerpts, installation logs, credential state, and machine-specific paths
are excluded. Source access and maintained package behavior may change; verify them
again when a future implementation depends on details not established here.
