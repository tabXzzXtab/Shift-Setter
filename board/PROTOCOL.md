# Board Protocol

- Workers: read tasks/, claim one (status: doing), do it, write result, move to done/failed.
- Lead: writes tasks and specs, reads results, never edits code.
- Owner: approves anything that goes live.
- No secrets in any board file.
- No deletions or irreversible actions without owner approval.
- One editor per file at a time.
- Ambiguity: pick the closest option to the spec, build it, list the choice under "owner points".
- Every result states what was NOT checked.
- Heartbeat: write alive-<role>.txt with current timestamp every 5 minutes while working.
