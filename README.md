# Protein Log hosting and legacy Mise address

Protein Log stays at **https://prinshen.github.io/mealplanner/protein-log/**.
Do not rename/delete this repository or move the `protein-log/` directory: existing phone installations use this address.

The meal planner now lives independently in [prinshen/mise](https://github.com/prinshen/mise), published at https://prinshen.github.io/mise/.
The old repository root and its service worker only hand off to Mise. Original icons remain for existing home-screen shortcuts.

## Data safety

- Protein Log application code, `proteinLog.v1` localStorage key, manifest, and start URL are unchanged by separation.
- No history is stored in this repository. History remains in the browser/installed app where it was entered.
- Protein Log's worker only cleans up caches beginning with `protein-log-`; cache files are not meal history.
- Mise continues to use `mise.v1` on the same `https://prinshen.github.io` origin.
- Do not clear website data or delete/reinstall the phone app as part of this migration. Keep exported backups.
- The original meal planner source remains recoverable in Git history before the separation commit.
