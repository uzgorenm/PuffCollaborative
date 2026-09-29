# Flower Agent area

Our workspace inside PuffCollaborative for Flower AgentApp work.

## Contents

- `flower_supergrid.ipynb`: offline hackathon prep for Flower agents. It uses a small mock runtime with the same object names as Flower's real API (`AgentApp`, `AgentSession`, `Context`, `agent.events.emit`), so code written here carries over to SuperGrid. It needs no Flower account, login, or API key.

## Requirements

- Python 3.11+
- Jupyter (`pip install jupyterlab`), or the VS Code Jupyter extension

## Run

```bash
cd flower
jupyter lab flower_supergrid.ipynb
```
