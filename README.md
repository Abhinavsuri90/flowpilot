# FlowPilot

Turn a plain-language description of a repetitive CSV report into a saved, versioned recipe that a whole workspace can run on their own files. AI drafts the recipe; a deterministic server executes it.

> Work in progress. See `context.md` for the current status.

## Run it

```bash
npm install
npm run dev        # seeds ./data/flowpilot.db on first run, then serves http://localhost:3000
```

Demo accounts (synthetic data), password `flowpilot-demo`:

| Person | Email | Workspace | Role |
|---|---|---|---|
| Asha Rao | asha@demo.local | Sales | admin |
| Vikram Nair | vikram@demo.local | Sales | member |
| Meera Iyer | meera@demo.local | Sales | viewer |
| Olivia Chen | olivia@demo.local | Marketing | admin |
