# PharmaStock — Decision Intelligence for Pharmacy Inventory

**Live demo:** https://pharmastock-puce.vercel.app · **[العربية](README_ar.md)**

PharmaStock tells a pharmacist **how much of each drug to order this month, and why**.
It combines demand forecasting, an inventory decision rule tested in simulation, and an AI assistant that answers questions using the system's own data.

## The problem

Many pharmacies reorder with fixed rules: a min/max level, or "order what we sold last month".
These rules ignore seasonality, supplier lead time, and expiry dates. The result is stockouts during peaks and excess or expired stock during slow months.

## How it works

| Pillar | What it does |
|---|---|
| **1. Forecast** | Monthly demand forecast for each drug with XGBoost, Prophet, and their average. The best model is chosen **per drug** on a separate validation window. |
| **2. Decide** | Order quantity = forecast for the arrival month + a safety stock tuned per drug − the stock left after this month. Evaluated in an inventory simulation with lead time, shelf life, and first-expired-first-out dispensing. |
| **3. Converse** | A ReAct agent (Gemini function calling, no LangChain) that calls 9 tools to answer questions such as *"What happens if we order only 500 boxes?"* |

## Results

Evaluated on **14 months the system never saw** during training or tuning, across 8 drug categories:

| Policy | Total cost | Units lost (stockouts) | Units expired | Fill rate |
|---|---:|---:|---:|---:|
| **PharmaStock** | **12,605** | **1,534** | 121 | **94.3%** |
| Seasonal average + safety stock | 14,780 | 1,653 | 61 | 93.8% |
| Forecast + fixed safety stock | 15,073 | 898 | 299 | 96.6% |
| Seasonal average (baseline) | 15,147 | 2,946 | 18 | 89.0% |
| Fixed order | 20,292 | 3,776 | 82 | 85.9% |
| Repeat last month | 41,033 | 7,591 | 1,794 | 71.7% |

- **16.8% lower total cost** than the seasonal-average baseline, with **48% fewer lost sales** (2,946 → 1,534).
- **Lowest total cost of all six policies.**
- Trade-off: more expired units than the baseline (121 vs 18), in exchange for far fewer stockouts.
- Cost = 1 × units held per month + 4 × units lost + 3 × units expired (relative weights, not currency).

## Where the advantage comes from

PharmaStock has the **lowest total cost across all drugs combined** compared with the five traditional policies.

| Drug category | PharmaStock rank (of 6) | Cheapest policy for this drug |
|---|:---:|---|
| Antihistamines | **1** | PharmaStock |
| Analgesics (aspirin) | **1** | PharmaStock |
| Analgesics (paracetamol) | 2 | Seasonal average |
| Respiratory drugs | 2 | Forecast + fixed safety stock |
| Hypnotics & sedatives | 2 | Seasonal average + safety stock |
| Anti-inflammatory (diclofenac) | 3 | Seasonal average + safety stock |
| Anxiolytics | 3 | Fixed order |
| Anti-inflammatory (ibuprofen) | 4 | Seasonal average |

- PharmaStock is the cheapest policy for 2 categories and in the **top two for 5 of the 8**.
- No traditional policy works well everywhere. Each one wins on a few drugs and fails badly on others:
  - The seasonal average is the cheapest for paracetamol, but on respiratory drugs it costs **5,586** versus **3,118** for PharmaStock.
  - A fixed monthly order is the cheapest for anxiolytics, but on paracetamol it costs **9,716** versus **5,201**.
- PharmaStock's edge is **consistency**: it never fails badly on any drug, so its combined cost is the lowest.

## AI assistant

The assistant never guesses numbers: every figure in an answer comes from a tool call, and the tools used are shown under each answer.

| Tool | Purpose |
|---|---|
| `get_inventory` | Current stock, expiring units, status |
| `forecast` | Demand forecast for the coming months |
| `calculate_order` | Recommended quantity with a step-by-step explanation |
| `simulate_order` | What-if simulation for any quantity, compared with the recommendation |
| `compare_drugs` | Side-by-side comparison of two drugs |
| `list_critical_drugs` | Drugs that need ordering now |
| `explain_seasonality` | Peak and low months from the full sales history |
| `compare_policies` | PharmaStock vs traditional policies for one drug |
| `query_sales` | Read-only SQL over the historical sales table |

**Guardrails**
- At most 5 reasoning rounds and 8 tool calls per question.
- No medical advice, and no order approval by the assistant; approval happens in the dashboard.
- Every tool call and answer is logged.
- The public demo allows 10 questions per visitor every 10 minutes.

## Tech stack

Python · pandas · XGBoost · Prophet · Flask · Google Gemini API (`google-genai`) · SQLite · JavaScript · Chart.js

## Project structure

```
notebooks/PharmaStock.ipynb     Data cleaning, forecasting, simulation, 6-month plan, export
server/agent.py                 Agent loop, tool definitions, guardrails
server/app.py                   Flask server: dashboard + POST /chat
server/test_agent.py            Tool and guardrail tests
pharmastock-dashboard/          Dashboard (display only, reads the notebook export)
api/index.py                    Vercel entry point for the Flask app
```

## Data and assumptions

- **Data:** [Pharma sales data](https://www.kaggle.com/datasets/milanzdravkovic/pharma-sales-data) (Kaggle), monthly sales of 8 ATC drug categories, January 2014 to September 2019.
- **Displayed dates are shifted forward by 7 years** so the demo reads as current (2021–2026). Months and seasonal patterns are unchanged.
- **Cleaning:** the last, incomplete month is dropped; one corrupted month (January 2017, almost zero sales) is filled by interpolation. Real peaks are kept.
- **Simulated, not real:** stock levels, a 1-month supplier lead time, a 2-month remaining shelf life at delivery, and the cost weights are assumptions. The "current method" baseline is also an assumed policy, not data from a real pharmacy.
