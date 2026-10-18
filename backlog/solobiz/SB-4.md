Marketing activity planner for a 3 h/week life.

A built-in library `solobiz/data/activity_library.json` of ≥ 24 low-time activity types (each: id, 中文名, minutes (10–90), cadence, expected effect on leads (S/M/L), prerequisites, steps checklist, success metric, examples):
ask-for-referral, testimonial collection, repurpose one piece of content into 5 posts, LinkedIn/X/WeChat post, newsletter, partner intro, local community event, small webinar, case-study write-up, past-client reactivation, directory/Google Business upkeep, guest post, offer-bundle test, price test, etc.
Scoring ICE (impact, confidence, ease) adjusted by minutes; `activities suggest` ranks by score per minute given the sales budget and what already ran; `activities plan --weeks 12` writes a 12-week calendar where each week's activity minutes
fit ≤ the sales share of the budget minus pipeline follow-ups; `activities log <id> --leads 2 --notes` records outcomes; `activities report` shows which types produced leads per hour. Tests: calendar fits the budget for random budgets,
ICE ranking deterministic, outcomes aggregate correctly, library schema validation (every entry complete, minutes sane).
