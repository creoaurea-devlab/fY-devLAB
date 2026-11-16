---
name: pragmatic-reproducible-workflow
description: Use when setup, build, testing, or a recurring local maintenance procedure depends on undocumented manual steps, or when the user asks to reproduce existing CI locally. Inspect current commands and automate only demonstrated repetition. Do not introduce infrastructure, upgrades, deployment changes, or a replacement CI system without a relevant request.
---

Pinned project-local source: `docs/rules/sources/Proto/Code-Maintenance-Skills-and-Rules/skills/pragmatic-reproducible-workflow/SKILL.md` (sha256:78d2bf430ae981eb38630bf3ccf6d6e6d6f771dddc468d1ccb46dd211065e871). Original edition retained.


# Pragmatic Reproducible Workflow

Respect the requested mode: for a review-only request, report findings without editing. For requested maintenance changes, implement the bounded change and verify it. Follow repository instructions and preserve unrelated user work.

Use this workflow to make one existing development procedure repeatable and diagnosable. It applies the book's practical emphasis on versioned work and useful automation. The goal is a reliable procedure a maintainer can understand, run, and repair.

## Discover the current procedure

Read repository instructions, package manifests, lockfiles, runtime declarations, existing scripts, and relevant CI configuration. Inspect version-control status before generating or editing files. Identify the specific task that currently requires repeated manual steps and write down its inputs, expected output, and failure conditions.

Use the repository's existing package manager and command sequence. Do not select a newer runtime or regenerate a lockfile simply because the installed local environment differs. Record required versions and distinguish missing tools, missing credentials, network limits, and actual source failures. Keep secret values out of command output and documentation.

For CI reproduction, map the existing relevant job to its local prerequisites and commands. Preserve the meaning of environment variables, working directories, dependency installation, and generated artifacts. Local execution may not reproduce a hosted runner exactly; record the differences that can affect the result. Inspect commands before running them so that a check target cannot unexpectedly publish, migrate production data, or deploy.

## Automate only the repeated friction

Prefer an existing task runner or a small script in the project's established location. Pass explicit inputs, validate prerequisites early, propagate failures, and make output useful for diagnosing the failed step. Use temporary directories for disposable outputs and limit cleanup to files the procedure owns. Quote paths correctly and avoid assumptions about a developer's home directory or globally installed tools.

Choose defaults that operate locally. Keep deployment, production database operations, broad filesystem cleanup, package upgrades, and credential management outside this workflow unless specifically relevant and authorized. Reading current CI to reproduce it does not imply permission or need to redesign CI. If the user asked only for an explanation, provide exact commands rather than writing automation.

Update the nearest maintained documentation with prerequisites, the single entry command, expected outputs, and any environment limitation. Link to the existing source of configuration rather than duplicating version numbers in several places. Avoid a new configuration layer for a one-off command.

## Run and inspect

Execute the procedure in the available safe environment. Check exit status and expected artifacts, not merely the presence of reassuring console text. If rerunning is safe, verify it does not corrupt existing outputs or introduce unexpected tracked changes. Use an isolated temporary directory for destructive fixture cases. Do not build an elaborate test suite for a thin command wrapper; focus on meaningful failures such as an invalid input or missing prerequisite.

Inspect the final diff for lockfile churn, generated noise, accidental secrets, and unrelated edits. Leave the user's work intact.

## Report

Provide the command to run, the repeated step removed, verified results, and material environment limits. Clearly state whether CI itself ran or only equivalent local commands ran. Do not claim byte-identical or clean-machine reproducibility without evidence.

## Source basis

- [Pearson/InformIT — original edition description and contents](https://www.informit.com/store/pragmatic-programmer-from-journeyman-to-master-9780201616224)
- [Pearson — original edition sample, tools chapter, and quick-reference card](https://ptgmedia.pearsoncmg.com/images/9780201616224/samplepages/020161622x.pdf)
- [Dave Thomas and Andy Hunt interview — Orthogonality and the DRY Principle](https://www.artima.com/articles/orthogonality-and-the-dry-principle)
