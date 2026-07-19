# Segment Scoring Rubric — Retail Personal-Finance Shorts

This rubric scores transcript segments for one niche: **short-form videos for a retail
personal-finance audience** — everyday people focused on budgeting, saving, index investing,
taxes, debt payoff, and retirement (NOT active traders, options, or crypto speculators). Score
each segment on the 5 dimensions (0-100 each), combine with the weighted formula, then apply the
Niche Relevance gate.

## Dimensions

### 1. Hook Strength (Weight: 0.25)

The first 3 seconds decide whether a money-focused viewer keeps watching. Score by hook archetype:

| Archetype | Example | Score Range |
|-----------|---------|-------------|
| Contrarian money take | "Stop maxing your 401(k) before you do this" | 80-100 |
| Specific number / goal | "How $200 a month becomes $1M by retirement" | 80-100 |
| Hidden cost / myth-bust | "The fee quietly eating 30% of your returns" | 75-95 |
| Costly mistake | "The tax mistake that costs new investors thousands" | 70-90 |
| Insider framing | "What your bank hopes you never figure out" | 70-90 |
| Simple rule / framework | "The 50/30/20 budget in 40 seconds" | 65-85 |
| Weak / generic | "So let's talk a bit about money..." | 10-40 |

**Boosters** (+5-10 each): a concrete dollar figure or percentage; a named vehicle (Roth IRA,
index fund, HYSA, 401k); a specific age or time horizon; lived experience ("I paid off $40k").

### 2. Financial Audience Value (Weight: 0.30) — the lead dimension

How useful and act-on-able the takeaway is for a retail personal-finance viewer. Reward clips
that leave the viewer with something they can DO with their money.

| Content | Score Range |
|---------|-------------|
| Specific actionable step/framework (how to budget, which account, exact allocation) | 85-100 |
| Concrete money insight with numbers (fees, compounding, tax impact) | 75-95 |
| Myth-bust or costly-mistake warning that includes the fix | 70-90 |
| Useful mental model (pay yourself first, right-sized emergency fund) | 60-80 |
| General guidance with a few specifics | 40-60 |
| Vague platitudes ("just save more", "invest early") with no how | 10-30 |

### 3. Standalone Coherence (Weight: 0.20)

Must make complete sense to someone who hasn't seen the rest of the video.

| Criteria | Score |
|----------|-------|
| Complete self-contained arc (setup -> insight -> resolution) | 85-100 |
| Complete idea with minor gaps a viewer can infer | 65-84 |
| Mostly standalone but references earlier content | 40-64 |
| Needs prior context to follow | 10-39 |
| Fragment — starts or ends mid-thought | 0-9 |

**Red flags** (auto low): "as I mentioned earlier", pronouns with no referent, cuts off mid-sentence.

### 4. Emotional Pull (Weight: 0.15)

Money emotions drive shares and saves.

| Signal | Score Range |
|--------|-------------|
| Conviction against conventional wisdom | 80-100 |
| "Aha" on a surprising number or fact | 75-95 |
| Relief / hope ("you can actually retire on this") | 70-90 |
| Fear of falling behind / costly-mistake dread | 65-85 |
| Calm-but-useful explanation | 40-60 |
| Monotone recitation | 10-30 |

### 5. Payoff Quality (Weight: 0.10)

| Ending | Score Range |
|--------|-------------|
| Punchline / satisfying reveal (the number, the answer) | 85-100 |
| Clear next step the viewer can take | 75-90 |
| Complete thought — natural stopping point | 65-80 |
| Fades into next topic | 40-60 |
| Cuts off mid-thought | 10-30 |

## Niche Relevance Gate

After the weighted score, judge how on-topic the clip is for this audience and cap accordingly:

- **On-topic** (budgeting, saving, investing, index funds, taxes, debt, income, retirement): no cap.
- **Tangential** (general career, business, or mindset with a money angle): cap final score at **65**.
- **Off-topic or off-audience** (not about money; or advanced/speculative — day-trading, options,
  leverage, meme coins): cap final score at **40**.

This keeps output in the personal-finance niche even when the source video wanders.

## Scoring Formula

```
weighted = (hook*0.25) + (financial_value*0.30) + (coherence*0.20) + (emotion*0.15) + (payoff*0.10)
final    = min(weighted, niche_relevance_cap)
```

## Candidate Selection Guidelines

1. **Count** scales with video length (the system requests a specific number per run).
2. **Duration sweet spot**: 35-50 seconds — the most-watched Shorts length. Prioritize a complete,
   self-contained moment over brevity. Go shorter (min 30s) only when a tighter cut is clearly
   stronger. Stay <=55s so the clip ends on a full sentence; 60s is the hard cap (clips are
   force-cut there, possibly mid-word).
3. **Minimum score**: don't propose clips below 60 after the formula (before the niche cap).
4. **Diversity**: spread across personal-finance subtopics (saving, investing, taxes, retirement) —
   don't return five clips on the same tip.
5. **Spacing**: prefer segments at least 2 minutes apart in the source.
6. **Natural boundaries**: align start/end with sentence boundaries, not mid-word.

## Hook Text Generation

For each selected segment, write a hook overlay:
- **Line 1**: 4-8 words — the money hook (a specific number, benefit, or mistake).
- **Line 2**: 3-6 words — context or the payoff tease.
- **Ground every number and claim in what's actually said in the clip — never invent figures,
  returns, or facts.**
- Lines should complement the spoken audio, not duplicate the first spoken words.
