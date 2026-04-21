# ops/

This folder contains service operation files for running usage-monitor jobs.

## Important files

- `launchd/com.hjyeo.usage-monitor-history-sampler.plist` - macOS launchd job that runs the history sampler every 300 seconds.

## Notes

- Keep service manifests in sync with script names, repo root, working directory, environment expectations, and log paths.
- The current `ops/` tree has launchd files only; there are no PM2 manifests here.
- Do not put secrets in service files.
