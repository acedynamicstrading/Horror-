# LENS
### AR Horror — Narrative Design Doc

---

## Decision Log (read this first)

Quick reference for pivots made over the course of design — later entries supersede earlier ones where they conflict:

- Developer's name is **Elusiv3** (a handle, not a stated real name) — not "Milo."
- **No weapons of any kind.** The lens itself is the only tool — see "Capture, Don't Kill" below. Candle/holy water/salt/sigil exist, but only as passive **support items**, never as damage sources. (An early pistol prototype was built and then explicitly cut — confirms this rule, doesn't change it.)
- **No flashlight item.** Instead, the lens view always renders with a simulated camera-flash/torch brightness baked into the ambient shader — a constant visual property of looking through the app, not something the player equips or aims.
- **Entities are never player-placed.** They spawn on their own from the room's SLAM surface data, using weighted logic (not pure random) — see Global Systems in the scene script.
- **Every entity's first-ever reveal is a pure jump scare, never capturable.** It crawls out, scares the player, then flees to a different spot in the room and goes dormant. Only when the player finds it again — wherever it fled to — does the reticle/capture-meter loop actually engage. First sighting teaches you it exists; you have to go hunt it down to actually do anything about it.
- **Support items are Elusiv3's own protective wards, unknowingly stripped from his own defenses.** Hidden truth, paired with the transfer-mechanism reveal — see Elusiv3's section below. The recalibration hiccup after every pickup is told to the player, in the moment, as the entities actively sabotaging the connection; it is never explained as anything more than that this installment.
- **Hand tracking is sequential, not simultaneous.** 8th Wall's `HandController` and `XrController` (SLAM) cannot run at the same time — confirmed directly by 8th Wall. Continuous two-hand play (one hand aiming, one hand interacting, live) would need a full native rebuild (ARKit+Vision on iOS is the clean version of that; ARCore+MediaPipe on Android has known reliability issues) — evaluated and **not adopted** for this installment. Instead: the core loop uses one-handed, thumb-operated on-screen controls (reticle + shutter), and hand tracking is reserved for short, self-contained item pickup/equip cutscenes only, with SLAM fully stopped and restarted around them.
- The final boss's **"thank you for freeing us" is spin, not truth** — the entity is gloating, not grateful. The real mechanism (capture = transfer to Elusiv3's apartment) is never explained to the player this installment.
- Ending is a hard cliffhanger — **"TO BE CONTINUED,"** no resolution, no branches, Part Two hooks only.

---

## Logline

A software developer accidentally builds an app that lets phone cameras see the dead. He uploads it before he understands what it does. You downloaded it. Now your house looks normal — until you look at it through your screen.

---

## The Premise (Cold Open / Prologue)

A solo dev who goes by the handle **Elusiv3** is building **MicroLens** — a computer-vision app meant to let a phone camera magnify and highlight microscopic organisms in real time (dust mites, bacteria, mold spores) using a cheap on-device ML model instead of an actual microscope. Portfolio project, nothing more.

A corrupted training set gets pulled into the build by mistake — old, mislabeled spectral-imaging data scraped from a defunct research archive without checking it closely. Instead of tuning the camera's filter to catch things too *small* to see, the model tunes it to catch things too *hidden* to see. Wrong axis, same math.

Elusiv3 runs it in his own apartment to test the microbe overlay. At first it just looks like a buggy filter — faint dark patches on the walls, texture noise that shouldn't be there, something like mold blooming and receding on the ceiling. He almost writes it off as a rendering artifact.

Then something steps out of the wall on his screen. Not on his wall. On his *screen*.

He doesn't understand what happened for weeks. He convinces himself it's a corrupted shader, a memory leak rendering garbage geometry, a webcam ghost in the literal sense — bad code, not a bad world. He cleans up the UI, writes a description that never mentions any of this because he doesn't believe it himself yet, and pushes **MicroLens** to a project-hosting site as a portfolio piece.

Someone downloads it. That's you.

---

## The Hook

Your phone isn't broken. It's a **portal** — the only one. The world in front of you is unchanged: your hallway, your kitchen, your own front door. Point the phone at it and the lens shows what's actually sharing the space with you. Dark shapes pressed into the walls. Shapes in the doorway that aren't there when you lower the phone. Something in the mirror that moves half a second late.

You can't fight what you can't see, and you can only see it through the screen. So you play the whole game the way Elusiv3 did that first night: **phone up, one eye on reality, one eye on the feed, never both at once.**

---

## Core Mechanic — "The Lens Rule"

- **Naked eye / real world:** looks completely ordinary. No monsters, no mess, no clue anything is wrong.
- **Through the phone (AR view):** the true layer — entities, residue, and your only means of doing anything about either.
- **There are no weapons.** The lens itself is the weapon. Banishing is done by *looking* — framing an entity in a targeting reticle and holding the shutter's focus, not by damaging it with an item.
- This creates the core horror tension: to fight, you must stare at a screen instead of the room around you — the game constantly makes you choose between situational awareness and lens awareness, and punishes you for either one.

Design implication: jump scares should be built around **peripheral-to-lens transitions** — something the player *glimpsed* moving in their real environment (a shadow at frame edge, a sound behind them) that they only understand once they whip the phone up and the lens reveals what was actually standing there.

---

## Core Mechanic — "Capture, Don't Kill"

The lens doesn't destroy entities — it **pulls them into the phone**, the same way a camera pulls in light. This is deliberate foreshadowing for the final boss reveal (see below): every "banishing" the player does all game is, in hindsight, an act of freeing rather than killing.

**The loop, entity by entity:**

1. **Spot** — an entity becomes visible in the lens (steps out of a wall patch, appears in a mirror, etc.). The moment it's first framed, a **capture timer** starts (a countdown — visible as a thinning ring around the reticle, not a number, to keep it diegetic).
2. **Flee vs. Hunt** — while the entity is inside the reticle and the player holds focus, it actively tries to escape frame: it dodges toward frame edges, ducks behind real furniture, phases through walls to break line of sight. The instant it leaves the lens view (or the player lowers the phone), it flips — now it's hunting, closing distance on the player in the real world, silent and invisible until the phone comes back up.
3. **Focus drain** — every continuous second the entity stays centered in the reticle, a visible pull effect drags it toward the screen (particle streaks, faint suction distortion) and its stability meter drops. Losing and re-finding the frame doesn't reset the meter, but it stops draining — precision and persistence are rewarded over panic-tapping.
4. **Capture** — meter hits zero → player taps the shutter (a snap-circle button, thumb-operated, sitting where a real camera app's shutter would) → a photographic flash-bang, shutter-click sound, and the entity is pulled fully into the screen and gone.
5. **Timeout (fail state)** — if the capture timer runs out before the meter empties, the entity breaks the frame violently: a scare beat where it rushes the player at close range, then flees to hide somewhere new and harder to reach — the encounter isn't lost, but it gets meaner and costs the player time.

**Support items** (found and equipped via the hand-tracking pickup cutscenes) don't deal damage — they're passive buffs, not spatial tools. No item is ever placed in the world; each is equipped once (or carries limited charges) and its effect applies globally from then on:
- A **candle** raises the lens's simulated-flash brightness a notch — capturable entities and residue read from further away.
- **Holy water** raises the player's Composure meter (see below) — more buffer before a breakout rush becomes a real problem.
- **Salt** slows every `HUNTING` entity's approach speed while `LENS_DOWN` — global, not a drawn line.
- A **ward sigil** eases the capture math — focus meter holds steadier through lost/re-found frames, or the capture timer runs a little more forgivingly.

None of these bring the meter down by themselves. The lens is the only thing that ever finishes a capture.

**Composure** — a small new resource introduced alongside this simplification, since removing spatial item interaction meant there was no longer anything at stake when a `BROKEN_OUT` rush happens. Composure takes a hit each time an entity breaks out and rushes the player; it doesn't gate a hard game-over on its own (keep failure soft, per the earlier "harder and longer, not a fail state" decision) but a depleted Composure meter should visibly worsen things — the lens grip shakes, the reticle drifts, capture timers run tighter — until it recovers naturally or the player finds more holy water.

---

## The Player Character

Deliberately near-blank — a name, never a face, no dialogue read aloud, just text-message style narration and a few scrawled journal/notes mechanics if you want collectibles. The less defined they are, the more the player projects themselves into "I downloaded this app onto my phone." First-person, present-tense framing throughout — never past tense, never third person, to keep the "you are living this" feeling.

---

## Elusiv3 — The Developer

Elusiv3 reads, for the whole game, as a scared stranger trying to get you to stop — nothing more, nothing less. **The player must never learn the real mechanic behind his warnings until the final boss.** Don't let devlogs, emails, or found notes spell it out early; keep everything he sends ambiguous enough to support "he just feels guilty" as the obvious reading.

### The truth (hidden from the player — designer/writer eyes only, revealed in the endgame twist)

Every entity the player "captures" with the lens isn't destroyed — it's *displaced*. MicroLens still phones home. Elusiv3 built in basic analytics before he knew any better (crash reports, anonymous usage pings), and that same pipe is now carrying something back: **every entity you capture in your house is being routed straight into his.** He isn't warning you out of general dread — he knows exactly what "capturing" actually does, and he's watching his own home fill up with everything you pull out of yours. He never tells you this. He can't risk you finding out and either stopping (leaving him with what's already arrived) or deliberately continuing (making it worse on purpose).

The same pipe runs both ways. Every **support item** the player finds and equips (candle, holy water, salt, sigil) isn't a neutral pickup — it's one of Elusiv3's own protective wards, pulled out of his apartment and routed into the player's toolkit by the same corrupted connection. He is losing his defenses at the same rate the player is gaining tools, on top of his home filling up with everything captured. The player has been quietly disarming the one person trying to help them, on two fronts, without ever being told either one is happening.

**What the player IS told, in the moment, at every pickup:** the recalibration hiccup after each hand-tracking cutscene is framed as the entities actively resisting/sabotaging the connection — true as far as it goes, and enough to explain the beat without giving away the mechanism underneath it.

This should feel, right up until the reveal, like a man who's simply losing his nerve. Only in hindsight — after the final boss — should his specific word choices in early notifications/calls reread as literal instead of panicked.

---

## In-Fiction Delivery — Notifications & Calls

**Push notifications** (arrive mid-gameplay, disguised as ordinary app notifications at first, degrading over time — nothing here should tip the twist):

- Early game (plausible/ordinary tone, plants unease):
  - *"MicroLens: unusual sensor activity detected."*
  - *"MicroLens: new update available. Do not install."* (inverted expectation — the update is normal, the instruction isn't)
- Mid game (his composure cracks):
  - *"delete this. delete this right now."*
  - *"why would you install this. why."*
  - *"it knows you're using it"*
- Late game (barely coherent, no more pretense of being a system message):
  - *"noooo. no no no. turn it off."*
  - *"i'm sorry. i didn't know. i'm so sorry."*
  - *"don't let it see you looking back"*

**Phone calls** (unskippable, low frequency, escalating): the player answers to a wash of static, a room tone that's subtly wrong (a hum, a dripping sound that doesn't match what Elusiv3 claims about where he is), and his voice breaking through only in fragments — never a full sentence, always cut by noise:

- Call 1 (curious/searching): *"—hello? is someone— MicroLens support, is this— "* [static swallows the rest]
- Call 2 (afraid): *"you have to stop— using it, I mean, stop *using*— it follows the— "* [cuts]
- Call 3 (breaking): *"—basement. don't look at the— I already looked, don't—"* [long silence, then a whisper that isn't his voice]

Keep every line **short, interrupted, and undersold.** The horror comes from what's implied being cut off, not from monologue — and none of it should read as literally true until the ending recontextualizes it.

---

## Structure — Three Acts, One House

**Act 1 — "Just a Filter"**
Player installs the app, calibrates it (tutorial), sees the first dark patches, first jump scare (something steps out of a wall). Tone: is this a bug? First notification arrives, ordinary-sounding. Player learns the shutter/reticle capture loop and gets the first support item (candle), low ghost activity.

**Act 2 — "It Knows You're Using It"**
Entities get bolder, start reacting to the lens being *up* versus *down* (hide when unwatched, closer when you look away then back). Elusiv3's messages shift from generic warnings to specific, personal ones (he starts naming things in *your* house he shouldn't know about — implying the app is also showing him you). First full phone call. The player should be reading Elusiv3 as increasingly unstable, not increasingly informative — no confirmation of what "elimination" is actually doing.

**Act 3 — "The Last Room"**
Final rooms, hardest entities, culminating in the boss encounter — something that doesn't behave like the others. It doesn't hide from the lens. It looks straight into the camera. This is where the twist lands.

---

## The Final Boss — The Reveal

The boss isn't just another ghost — it's the accumulated weight of everything the player has captured all game, finally cornered and no longer pretending to be afraid of the lens. Where every prior entity fled the reticle, this one doesn't move at all — it stares straight down the lens and lets the capture lock, breaking the one rule the whole game just spent three acts teaching the player to trust.

**Boss dialogue beat (on defeat / final cutscene):**

> *"...thank you. For freeing us."*
> [it laughs — wrong, layered, more than one voice]
> *"Now — we go eliminate the creator."*

**Writer's note — this line is spin, not truth.** The entity isn't grateful; it's gloating. "Freeing" is the flattering version of "you were a tool that gave us a target and a way out." Play the laugh as *satisfied/mocking*, never warm — the horror is that the player was used, not that they did something good that went sideways. The player doesn't get the real mechanism (the transfer-to-Elusiv3's-apartment pipeline) explained here or anywhere else this installment — that's a Part Two reveal, if it ever gets spelled out at all.

No further explanation is given in-game. The realization that every capture all game was a *transfer*, not an ending, and that the swarm now has a location to go find, lands entirely on the player in this moment — re-reading every prior notification and call in hindsight. Elusiv3's phone goes dark. The screen cuts to black mid-static.

**Closing card:**
> *TO BE CONTINUED*

No resolution, no player choice at this stage — the ending is a cliffhanger by design, setting up Part Two (playing as, or racing to warn, Elusiv3).

---

## Tone Notes for Implementation

- Never explain the rules out loud — let the player infer "phone up = truth, phone down = safety-shaped lie" through a couple of early scares, not a tutorial pop-up.
- Elusiv3 should feel like a person losing a fight in real time, not an omniscient narrator — he should occasionally be *wrong* about what's coming, which is scarier than him being right, and which also helps mask the twist.
- Reserve full jump scares for lens-transition moments (see Core Mechanic) — overusing them flattens the "am I safe right now?" tension the whole game runs on.
- Your `hauntedShader.js` is a natural home for the "world looks almost normal, then wrong" effect — subtle darkening/patch artifacts before any entity spawns, so players learn to distrust quiet rooms.
- Guard the twist carefully in any barks, UI text, or achievement names — avoid words like "transfer," "route," or "his house" anywhere accessible before the final boss.

---

## Open Hooks for Part Two
- Part Two picks up immediately post-cliffhanger — does the player take on Elusiv3's perspective, defending his apartment from what just arrived, or race against time to reach/warn him?
- Does Elusiv3 survive to be a guide/ally in Part Two, or is his fate already sealed and Part Two is about stopping the swarm from spreading further (to whoever downloads MicroLens next)?
- The chain implied by the ending — download, use, "free" the ghosts onto someone else — sets up a built-in sequel hook: the swarm doesn't stop at one creator, it goes wherever the next signal leads.
