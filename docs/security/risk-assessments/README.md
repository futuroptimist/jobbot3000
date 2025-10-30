# Security risk assessments archive

Render Markdown reports for each launch and store them in this directory. Use
`scripts/generate-risk-assessment.js` (via `npm run security:risk-assessment`)
to convert JSON threat model configs into Markdown summaries.

Each report should link back to the originating feature spec and include the
commit SHA that shipped the mitigations. The regression coverage described in
[`docs/security-risk-assessment-guide.md`](../security-risk-assessment-guide.md)
keeps the tooling and documentation aligned.
