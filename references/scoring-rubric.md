# Segment Scoring Rubric — Telugu Food-Reaction Shorts

This rubric scores transcript segments for **reaction shorts from a Telugu food vlogger** — the best
moments of him tasting and reacting to food. The transcript is **romanized Telugu (Tenglish) plus
English** and captures only what he *says* — the on-camera reaction is visual and not in the text —
so treat these scores as a **helper for the manual timeline editor**, not the final call. Score each
segment on the 5 dimensions (0-100), then combine with the weighted formula.

## Dimensions

### 1. Reaction Intensity (Weight: 0.35) — the lead dimension

How strong and watchable the on-mic reaction is.

| Signal | Score Range |
|--------|-------------|
| Explosive first-bite verdict / exclamation ("abba!", "super!", "adirindi!", "spicy ra!") | 85-100 |
| Clear delight, surprise, or disgust with energy | 75-95 |
| Big laugh / genuinely funny bit | 75-95 |
| Strong opinion on the dish (loves it / hates it, with conviction) | 65-85 |
| Mild "mm, bagundi" / lukewarm comment | 35-55 |
| Flat narration, no reaction | 5-25 |

### 2. Standalone Clarity (Weight: 0.20)

Makes sense to a viewer dropped into the middle.

| Criteria | Score |
|----------|-------|
| Complete beat: sees the food → tastes → reacts | 85-100 |
| Clear reaction with minor missing context | 65-84 |
| Leans on an earlier dish/moment to make sense | 40-64 |
| Fragment / starts or ends mid-thought | 0-30 |

### 3. Entertainment & Personality (Weight: 0.20)

Charisma, humor, expressiveness — the reason people follow him.

| Signal | Score Range |
|--------|-------------|
| Big, expressive, quotable moment | 80-100 |
| Funny aside or catchphrase | 70-90 |
| Warm/engaging but ordinary | 45-65 |
| Monotone | 10-30 |

### 4. Food Appeal & Hook (Weight: 0.15)

How mouth-watering / hook-worthy the dish moment is.

| Signal | Score Range |
|--------|-------------|
| Reveal of a striking / unusual / iconic dish | 80-100 |
| Vivid description that makes you crave it | 70-90 |
| Ordinary dish mention | 40-60 |
| No food in focus | 10-30 |

### 5. Payoff (Weight: 0.10)

Lands on a clear verdict or punchline.

| Ending | Score Range |
|--------|-------------|
| Punchy verdict / catchphrase ("must try ra!") | 85-100 |
| Clear reaction conclusion | 65-85 |
| Trails off | 30-55 |
| Cuts mid-thought | 10-30 |

## Reject (score low)

Travel/walking B-roll, intros/outros, price haggling, sponsor reads, and flat narration with no
reaction — score these under 30 so they never surface as candidates.

## Scoring Formula

```
final = (reaction*0.35) + (clarity*0.20) + (personality*0.20) + (food*0.15) + (payoff*0.10)
```

## Candidate Selection Guidelines

1. **Count** scales with video length (the system requests a specific number per run).
2. **Duration**: 15-40 seconds, aiming 20-35s — reaction shorts are punchy. Start/end on natural
   speech boundaries.
3. **Diversity**: spread across different dishes/moments — don't return five clips of the same bite.
4. **Spacing**: prefer moments spread across the video.
5. This is a **helper** — the human picks and trims the final clips on the timeline, so surface the
   strongest reaction candidates and don't force weak ones.

## Hook Text Generation

- **Line 1**: 4-8 words — a punchy Tenglish/English hook grounded in what he says (e.g. "Idi chala
  bagundi!", "Super spicy ra!").
- **Line 2**: 3-6 words — the dish or context.
- Ground every hook in his actual words — never invent. Keep it in the vlogger's voice.
