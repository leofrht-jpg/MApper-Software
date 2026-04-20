# MApper Installation Guide

## Prerequisites

- **Miniconda** or Anaconda ([download](https://docs.conda.io/en/latest/miniconda.html))
- **Node.js 18+** ([download](https://nodejs.org))
- **ecoinvent 3.10** license and `.7z` file (cutoff system model)
- **Git** ([download](https://git-scm.com))

## Quick Start (macOS / Linux)

```bash
git clone https://github.com/leofrht-jpg/MApper-Software.git
cd MApper-Software
chmod +x setup.sh
./setup.sh
./start.sh
```

Then open http://localhost:5173

## Quick Start (Windows)

```bat
git clone https://github.com/leofrht-jpg/MApper-Software.git
cd MApper-Software
setup.bat
```

## First Run

1. Open MApper in your browser (http://localhost:5173)
2. Go to **Database Explorer** → Import your ecoinvent `.7z` file
3. Wait for import (~5–10 minutes for 23,000 activities)
4. Start exploring!

## Optional: Premise Key (for Prospective LCA)

To generate prospective databases, you need an encryption key:
1. Email romain.sacchi@psi.ch to request a key
2. In MApper, go to **Settings → Premise** and paste the key, or write it manually: `mkdir -p ~/.premise && echo 'YOUR_KEY' > ~/.premise/premise_key`
3. Go to **pLCA Developer** in MApper to generate future databases

## System Requirements

|         | Minimum                                   | Recommended                    |
| ------- | ----------------------------------------- | ------------------------------ |
| RAM     | 8 GB                                      | 16 GB                          |
| Disk    | 5 GB                                      | 15 GB (with prospective DBs)   |
| OS      | macOS 13+, Windows 10+, Ubuntu 22.04+     |                                |
| Python  | 3.11                                      | 3.11                           |
| Node.js | 18                                        | 20+                            |

## Troubleshooting

**Port already in use:** Kill existing processes: `lsof -ti :8000 | xargs kill`
**ecoinvent import fails:** Use the cutoff `.7z` file (not lci or lcia variants)
**Premise key error:** Verify key is saved in `~/.premise/premise_key` (single line, no spaces)

## Contact

Leonardo Ferhati — leofe@dtu.dk
mapper.leonardoferhati.com
